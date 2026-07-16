import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { isValidTwilioSignature } from '../lib/twilio/signature'
import { getQueueById } from '../db/queues'
import { insertCall, getCallBySid, updateCallOutcome } from '../db/calls'
import { getOrgSettings, DEFAULT_ANNOUNCEMENT } from '../db/settings'
import { insertRecording } from '../db/recordings'
import { startCallRecording, fetchRecordingMedia } from '../lib/twilio/provisioning'
import { pushPresence } from './realtime'

// Twilio-called webhooks, not browser-called: outside the AuthPak gate (mounted before it
// in server/app.ts). Trust is established per-request via the X-Twilio-Signature header,
// never via the fnd_session cookie.
export const voice = new Hono<Env>()

async function parseFormParams(req: Request): Promise<Record<string, string>> {
  const form = await req.formData()
  const params: Record<string, string> = {}
  for (const [k, v] of form.entries()) if (typeof v === 'string') params[k] = v
  return params
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function twiml(xml: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${xml}`, { status: 200, headers: { 'content-type': 'text/xml' } })
}

// POST /api/voice/inbound?orgId=...&queueId=... — enqueues the caller into the org's Workflow.
// orgId/queueId identify the org's Workflow via the webhook URL configured on the Twilio
// number (no cc_numbers table yet — see PROGRESS.md Step 8 for the tradeoff).
voice.post('/inbound', async (c) => {
  const params = await parseFormParams(c.req.raw)
  const signature = c.req.header('X-Twilio-Signature')
  if (!(await isValidTwilioSignature(c.env.TWILIO_AUTH_TOKEN, c.req.url, params, signature ?? null))) {
    return err(c, 'bad_signature', 'Invalid Twilio signature', 403)
  }

  const orgId = c.req.query('orgId')
  const queueId = c.req.query('queueId')
  if (!orgId || !queueId) return err(c, 'bad_input', 'orgId and queueId are required', 400)
  const queue = await getQueueById(c.env.DB, orgId, queueId)
  if (!queue?.twilioWorkflowSid) return err(c, 'not_found', 'Queue not found or not provisioned', 404)

  const task = escapeXml(JSON.stringify({ organization_id: orgId, from: params.From ?? '', to: params.To ?? '' }))
  // The consent invariant (Steven, 2026-07-16): the announcement is a function of
  // recording_enabled — never a separate toggle. Recording off => TwiML is
  // byte-for-byte what Phase 3 emits.
  const settings = await getOrgSettings(c.env.DB, orgId)
  const say = settings.recordingEnabled
    ? `<Say>${escapeXml(settings.announcementText ?? DEFAULT_ANNOUNCEMENT)}</Say>`
    : ''
  return twiml(`<Response>${say}<Enqueue workflowSid="${queue.twilioWorkflowSid}"><Task>${task}</Task></Enqueue></Response>`)
})

// POST /api/voice/status?orgId=...&queueId=... — records call state into cc_calls and
// pushes an event to the org's realtime DO.
voice.post('/status', async (c) => {
  const params = await parseFormParams(c.req.raw)
  const signature = c.req.header('X-Twilio-Signature')
  if (!(await isValidTwilioSignature(c.env.TWILIO_AUTH_TOKEN, c.req.url, params, signature ?? null))) {
    return err(c, 'bad_signature', 'Invalid Twilio signature', 403)
  }

  const orgId = c.req.query('orgId')
  const callSid = params.CallSid
  if (!orgId) return err(c, 'bad_input', 'orgId is required', 400)
  if (!callSid) return err(c, 'bad_input', 'CallSid is required', 400)
  const status = params.CallStatus ?? 'unknown'
  const durationS = params.CallDuration ? Number(params.CallDuration) : null

  const existing = await getCallBySid(c.env.DB, orgId, callSid)
  if (!existing) {
    await insertCall(c.env.DB, {
      id: crypto.randomUUID(), organizationId: orgId, twilioCallSid: callSid,
      fromE164: params.From ?? '', toE164: params.To ?? '', queueId: c.req.query('queueId') ?? null,
    })
  }
  await updateCallOutcome(c.env.DB, orgId, callSid, { disposition: status, durationS, agentId: existing?.agentId ?? null })

  // Best-effort recording start, mirroring pushPresence's non-fatal posture — a
  // recording failure must never fail the status webhook. Only fires when the org
  // has recording enabled (the consent invariant gates this at the settings layer).
  if (params.CallStatus === 'in-progress') {
    const settings = await getOrgSettings(c.env.DB, orgId)
    if (settings.recordingEnabled) {
      const cb = new URL(c.req.url)
      cb.pathname = '/api/voice/recording' // keeps ?orgId=&queueId=
      try {
        await startCallRecording(c.env, { callSid, recordingStatusCallback: cb.toString() })
      } catch (e) {
        console.error('startCallRecording failed', e)
      }
    }
  }

  await pushPresence(c.env, orgId, { identity: `call:${callSid}`, status, at: Date.now() })
  return c.body(null, 204)
})

// POST /api/voice/recording?orgId=... — Twilio's recordingStatusCallback. Audio bytes
// land in R2 (real even in dry-run — Miniflare simulates R2 locally); D1 holds metadata only.
voice.post('/recording', async (c) => {
  const params = await parseFormParams(c.req.raw)
  const signature = c.req.header('X-Twilio-Signature')
  if (!(await isValidTwilioSignature(c.env.TWILIO_AUTH_TOKEN, c.req.url, params, signature ?? null))) {
    return err(c, 'bad_signature', 'Invalid Twilio signature', 403)
  }
  const orgId = c.req.query('orgId')
  if (!orgId) return err(c, 'bad_input', 'orgId is required', 400)
  if ((params.RecordingStatus ?? '') !== 'completed') return c.body(null, 204)

  const callSid = params.CallSid
  const recordingSid = params.RecordingSid
  if (!callSid || !recordingSid) return err(c, 'bad_input', 'CallSid and RecordingSid are required', 400)

  const call = await getCallBySid(c.env.DB, orgId, callSid)
  if (!call) return err(c, 'not_found', 'Call not found', 404)

  const key = `orgs/${orgId}/calls/${callSid}/${recordingSid}.mp3`
  const bytes = await fetchRecordingMedia(c.env, { recordingSid, mediaUrl: params.RecordingUrl ?? '' })
  await c.env.RECORDINGS.put(key, bytes)

  const id = crypto.randomUUID()
  await insertRecording(c.env.DB, {
    id, organizationId: orgId, callId: call.id, twilioRecordingSid: recordingSid, r2Key: key,
    durationS: params.RecordingDuration ? Number(params.RecordingDuration) : null,
  })
  return c.body(null, 204) // Step 7 adds the waitUntil transcription hand-off here.
})
