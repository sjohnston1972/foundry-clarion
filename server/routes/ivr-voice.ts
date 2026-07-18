import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { isValidTwilioSignature } from '../lib/twilio/signature'
import { getIvrFlowById } from '../db/ivr-flows'
import { getQueueById } from '../db/queues'
import { getOrgSettings, DEFAULT_ANNOUNCEMENT } from '../db/settings'
import { insertVoicemail } from '../db/voicemails'
import { fetchRecordingMedia } from '../lib/twilio/provisioning'
import { transcribeVoicemail } from '../lib/ai/transcribe'
import { interpret, type Vars } from '../lib/ivr/interpret'
import type { IvrFlowDefinition } from '../lib/ivr/graph'

// Twilio-called webhook, not browser-called: outside the AuthPak gate, mounted alongside
// `voice` (server/routes/voice.ts). Trust is established per-request via X-Twilio-Signature.
export const ivrVoice = new Hono<Env>()

async function parseFormParams(req: Request): Promise<Record<string, string>> {
  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v
  return params
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, { status: 200, headers: { 'content-type': 'text/xml' } })
}

function encodeVars(vars: Vars): string {
  return btoa(JSON.stringify(vars))
}

function decodeVars(raw: string | undefined): Vars {
  if (!raw) return {}
  try {
    return JSON.parse(atob(raw)) as Vars
  } catch {
    return {}
  }
}

// POST /api/voice/ivr?orgId=<org>&flowId=<flow>[&node=<id>][&vars=<b64>] — handles both flow
// entry (node absent) and every Gather continuation (node + vars carried in the query string).
ivrVoice.post('/ivr', async (c) => {
  const params = await parseFormParams(c.req.raw)
  const signature = c.req.header('X-Twilio-Signature')
  if (!(await isValidTwilioSignature(c.env.TWILIO_AUTH_TOKEN, c.req.url, params, signature ?? null))) {
    return err(c, 'bad_signature', 'Invalid Twilio signature', 403)
  }

  const orgId = c.req.query('orgId')
  const flowId = c.req.query('flowId')
  if (!orgId || !flowId) return err(c, 'bad_input', 'orgId and flowId are required', 400)

  const flow = await getIvrFlowById(c.env.DB, orgId, flowId)
  if (!flow) return err(c, 'not_found', 'Flow not found', 404)

  const definition = flow.definition as IvrFlowDefinition
  const startNodeId = c.req.query('node') ?? definition.entryNodeId
  const vars = decodeVars(c.req.query('vars'))

  // Only fetched once per request, not per walk-step: interpret() is pure and takes the
  // whole map, since it can't know in advance which routeToQueue node (if any) it'll reach.
  const queueWorkflowSids: Record<string, string> = {}
  for (const node of definition.nodes) {
    if (node.type === 'routeToQueue' && !(node.config.queueId in queueWorkflowSids)) {
      const queue = await getQueueById(c.env.DB, orgId, node.config.queueId)
      if (queue?.twilioWorkflowSid) queueWorkflowSids[node.config.queueId] = queue.twilioWorkflowSid
    }
  }

  const settings = await getOrgSettings(c.env.DB, orgId)
  const recordingConsentSay = settings.recordingEnabled
    ? `<Say>${escapeXml(settings.announcementText ?? DEFAULT_ANNOUNCEMENT)}</Say>`
    : ''
  const enqueueTaskXml = `<Task>${escapeXml(JSON.stringify({ organization_id: orgId, from: params.From ?? '', to: params.To ?? '' }))}</Task>`

  const voicemailUrl = new URL(c.req.url)
  voicemailUrl.search = ''
  voicemailUrl.pathname = voicemailUrl.pathname.replace(/\/ivr$/, '/voicemail')
  voicemailUrl.searchParams.set('orgId', orgId)
  voicemailUrl.searchParams.set('flowId', flowId)
  voicemailUrl.searchParams.set('callSid', params.CallSid ?? '')

  const result = interpret(definition, startNodeId, vars, {
    digits: params.Digits || undefined,
    now: new Date(),
    buildGatherActionUrl: (nodeId, v) => {
      const url = new URL(c.req.url)
      url.search = ''
      url.searchParams.set('orgId', orgId)
      url.searchParams.set('flowId', flowId)
      url.searchParams.set('node', nodeId)
      url.searchParams.set('vars', encodeVars(v))
      return url.toString()
    },
    voicemailActionUrl: voicemailUrl.toString(),
    voicemailStatusCallbackUrl: voicemailUrl.toString(),
    queueWorkflowSids,
    enqueueTaskXml,
    recordingConsentSay,
  })

  return twiml(result.twiml)
})

// POST /api/voice/voicemail?orgId=<org>&flowId=<flow>&callSid=<sid> — the voicemail node's
// recordingStatusCallback (and action). Stores audio to R2 + a cc_voicemails row, then hands
// transcription off via waitUntil, mirroring the Phase 4 call-recording pipeline.
ivrVoice.post('/voicemail', async (c) => {
  const params = await parseFormParams(c.req.raw)
  const signature = c.req.header('X-Twilio-Signature')
  if (!(await isValidTwilioSignature(c.env.TWILIO_AUTH_TOKEN, c.req.url, params, signature ?? null))) {
    return err(c, 'bad_signature', 'Invalid Twilio signature', 403)
  }

  const orgId = c.req.query('orgId')
  if (!orgId) return err(c, 'bad_input', 'orgId is required', 400)
  if ((params.RecordingStatus ?? '') !== 'completed') return c.body(null, 204)

  const callSid = params.CallSid ?? c.req.query('callSid')
  const recordingSid = params.RecordingSid
  if (!callSid || !recordingSid) return err(c, 'bad_input', 'CallSid and RecordingSid are required', 400)

  // The flow link is best-effort (cc_voicemails.flow_id is nullable, ON DELETE SET NULL):
  // an unknown/cross-org flowId just means we don't attribute the voicemail to a flow.
  const flowIdParam = c.req.query('flowId')
  const flow = flowIdParam ? await getIvrFlowById(c.env.DB, orgId, flowIdParam) : null

  const key = `orgs/${orgId}/voicemails/${callSid}/${recordingSid}.mp3`
  const bytes = await fetchRecordingMedia(c.env, { recordingSid, mediaUrl: params.RecordingUrl ?? '' })
  await c.env.RECORDINGS.put(key, bytes)

  const id = crypto.randomUUID()
  await insertVoicemail(c.env.DB, {
    id, organizationId: orgId, flowId: flow?.id ?? null, twilioCallSid: callSid,
    fromE164: params.From ?? null, r2Key: key,
    durationS: params.RecordingDuration ? Number(params.RecordingDuration) : null,
    createdAt: Date.now(),
  })
  // Hand transcription off out-of-band — Twilio must never wait on Whisper.
  c.executionCtx.waitUntil(transcribeVoicemail(c.env, { orgId, voicemailId: id, r2Key: key }))
  return c.body(null, 204)
})
