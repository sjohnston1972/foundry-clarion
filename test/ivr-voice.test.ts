import { describe, it, expect } from 'vitest'
import { createApp } from '../server/app'
import { computeTwilioSignature } from '../server/lib/twilio/signature'
import type { IvrFlowDefinition } from '../server/lib/ivr/graph'

type FakeDbHandle = D1Database & { voicemailsStore: Record<string, unknown>[] }

const AUTH_TOKEN = 'test-auth-token'
const BASE_URL = 'http://localhost'

// start -> play -> menu -[1]-> routeToQueue(q_123), -[2]-> voicemail, -[timeout]-> hangup, -[invalid]-> play
const flowDef: IvrFlowDefinition = {
  entryNodeId: 'n_start',
  nodes: [
    { id: 'n_start', type: 'start', position: { x: 0, y: 0 }, config: {} },
    { id: 'n_hi', type: 'play', position: { x: 0, y: 0 }, config: { say: 'Thanks for calling Acme.' } },
    { id: 'n_menu', type: 'menu', position: { x: 0, y: 0 }, config: { prompt: 'Press 1 for Sales, 2 for Support.', timeoutSeconds: 5 } },
    { id: 'n_sales', type: 'routeToQueue', position: { x: 0, y: 0 }, config: { queueId: 'q_123' } },
    { id: 'n_vm', type: 'voicemail', position: { x: 0, y: 0 }, config: { prompt: 'Leave a message.', maxLengthSeconds: 120 } },
    { id: 'n_bye', type: 'hangup', position: { x: 0, y: 0 }, config: {} },
  ],
  edges: [
    { source: 'n_start', target: 'n_hi', branch: 'next' },
    { source: 'n_hi', target: 'n_menu', branch: 'next' },
    { source: 'n_menu', target: 'n_sales', branch: '1' },
    { source: 'n_menu', target: 'n_vm', branch: '2' },
    { source: 'n_menu', target: 'n_bye', branch: 'timeout' },
    { source: 'n_menu', target: 'n_hi', branch: 'invalid' },
  ],
}

function fakeDb(): FakeDbHandle {
  const flows: Record<string, unknown>[] = [
    { id: 'f1', organization_id: 'o1', name: 'Main IVR', status: 'active', definition_json: JSON.stringify(flowDef), updated_at: 1000 },
  ]
  const queues: Record<string, unknown>[] = [
    { id: 'q_123', organization_id: 'o1', name: 'Sales', twilio_workflow_sid: 'WWtest123', strategy: 'longest-idle' },
  ]
  const voicemails: Record<string, unknown>[] = []
  const db = {
    voicemailsStore: voicemails,
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_ivr_flows')) return flows.find((f) => f.organization_id === a[0] && f.id === a[1]) ?? null
            if (sql.includes('FROM cc_queues')) return queues.find((q) => q.organization_id === a[0] && q.id === a[1]) ?? null
            if (sql.includes('FROM cc_org_settings')) return null // recording off (default posture)
            return null
          },
          async run() {
            if (sql.startsWith('INSERT INTO cc_voicemails')) {
              voicemails.push({
                id: a[0], organization_id: a[1], flow_id: a[2], twilio_call_sid: a[3], from_e164: a[4],
                r2_key: a[5], duration_s: a[6], created_at: a[7], transcript_r2_key: null, transcript_status: 'pending',
              })
            }
            if (sql.startsWith('UPDATE cc_voicemails')) {
              const row = voicemails.find((v) => v.organization_id === a[2] && v.id === a[3])
              if (row) { row.transcript_r2_key = a[0]; row.transcript_status = a[1] }
            }
            return {}
          },
        }),
      }
    },
  }
  return db as unknown as FakeDbHandle
}

function fakeR2() {
  const store = new Map<string, ArrayBuffer>()
  return {
    bucket: {
      put: async (k: string, v: ArrayBuffer) => { store.set(k, v); return {} },
      get: async (k: string) => (store.has(k) ? { arrayBuffer: async () => store.get(k)!, body: null } : null),
    } as unknown as R2Bucket,
    store,
  }
}

const env = (r2?: R2Bucket) => ({ DB: fakeDb(), TWILIO_AUTH_TOKEN: AUTH_TOKEN, RECORDINGS: r2 ?? fakeR2().bucket })

async function signedRequest(path: string, params: Record<string, string>) {
  const url = `${BASE_URL}${path}`
  const signature = await computeTwilioSignature(AUTH_TOKEN, url, params)
  return { headers: { 'X-Twilio-Signature': signature, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() }
}

// Pulls the `action="..."` URL Twilio would call back on out of a <Gather> fragment,
// mirroring how the real caller round-trips node + vars through the query string.
function extractGatherAction(twimlBody: string): string {
  const match = twimlBody.match(/<Gather[^>]*\baction="([^"]+)"/)
  if (!match) throw new Error(`no Gather action found in: ${twimlBody}`)
  return match[1].replace(/&amp;/g, '&')
}

describe('POST /api/voice/ivr — signature validation', () => {
  it('rejects a missing signature with 403', async () => {
    const res = await createApp().request('/api/voice/ivr?orgId=o1&flowId=f1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: '',
    }, env())
    expect(res.status).toBe(403)
  })

  it('rejects an invalid signature with 403', async () => {
    const res = await createApp().request('/api/voice/ivr?orgId=o1&flowId=f1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'not-the-real-signature' }, body: '',
    }, env())
    expect(res.status).toBe(403)
  })
})

describe('POST /api/voice/ivr — entry vs continuation', () => {
  it('entry (no node/vars): walks start -> play -> menu and stops at the Gather', async () => {
    const req = await signedRequest('/api/voice/ivr?orgId=o1&flowId=f1', {})
    const res = await createApp().request('/api/voice/ivr?orgId=o1&flowId=f1', { method: 'POST', ...req }, env())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/xml')
    const body = await res.text()
    expect(body).toContain('<Say>Thanks for calling Acme.</Say>')
    expect(body).toContain('<Gather numDigits="1" timeout="5"')
    expect(body).toContain('Press 1 for Sales, 2 for Support.')
  })

  it('digit callback advances: pressing "1" on the menu routes to the queue and terminates', async () => {
    const entryReq = await signedRequest('/api/voice/ivr?orgId=o1&flowId=f1', {})
    const entryRes = await createApp().request('/api/voice/ivr?orgId=o1&flowId=f1', { method: 'POST', ...entryReq }, env())
    const actionUrl = extractGatherAction(await entryRes.text())
    const path = actionUrl.replace(BASE_URL, '')

    const params = { Digits: '1' }
    const req = await signedRequest(path, params)
    const res = await createApp().request(path, { method: 'POST', ...req }, env())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('<Enqueue workflowSid="WWtest123">')
  })

  it('a Gather timeout (no Digits) follows the "timeout" branch to Hangup', async () => {
    const entryReq = await signedRequest('/api/voice/ivr?orgId=o1&flowId=f1', {})
    const entryRes = await createApp().request('/api/voice/ivr?orgId=o1&flowId=f1', { method: 'POST', ...entryReq }, env())
    const actionUrl = extractGatherAction(await entryRes.text())
    const path = actionUrl.replace(BASE_URL, '')

    const req = await signedRequest(path, {})
    const res = await createApp().request(path, { method: 'POST', ...req }, env())
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<Hangup/>')
  })

  it('an unmapped digit follows "invalid" and re-prompts with a fresh Gather', async () => {
    const entryReq = await signedRequest('/api/voice/ivr?orgId=o1&flowId=f1', {})
    const entryRes = await createApp().request('/api/voice/ivr?orgId=o1&flowId=f1', { method: 'POST', ...entryReq }, env())
    const actionUrl = extractGatherAction(await entryRes.text())
    const path = actionUrl.replace(BASE_URL, '')

    const req = await signedRequest(path, { Digits: '9' })
    const res = await createApp().request(path, { method: 'POST', ...req }, env())
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Thanks for calling Acme.')
    expect(body).toContain('<Gather')
  })
})

describe('POST /api/voice/ivr — cross-org / unknown flow', () => {
  it('an unknown flowId is a 404', async () => {
    const req = await signedRequest('/api/voice/ivr?orgId=o1&flowId=f_missing', {})
    const res = await createApp().request('/api/voice/ivr?orgId=o1&flowId=f_missing', { method: 'POST', ...req }, env())
    expect(res.status).toBe(404)
  })

  it('a flow that belongs to another org is a 404 (never 403 — no cross-org existence leak)', async () => {
    const req = await signedRequest('/api/voice/ivr?orgId=o2&flowId=f1', {})
    const res = await createApp().request('/api/voice/ivr?orgId=o2&flowId=f1', { method: 'POST', ...req }, env())
    expect(res.status).toBe(404)
  })
})

describe('POST /api/voice/voicemail — voicemail node callback', () => {
  const vmParams = (over: Record<string, string> = {}) => ({
    CallSid: 'CAdryrun_1', RecordingSid: 'REdryrun_x', RecordingStatus: 'completed',
    RecordingDuration: '30', RecordingUrl: 'https://api.twilio.com/fake/REdryrun_x', From: '+15551234567', ...over,
  })

  const postVoicemail = async (
    e: ReturnType<typeof env>, query: string, params: Record<string, string>, waited: Promise<unknown>[] = [],
  ) => {
    const path = `/api/voice/voicemail?${query}`
    const req = await signedRequest(path, params)
    const ctx = { waitUntil: (p: Promise<unknown>) => { waited.push(p) }, passThroughOnException: () => {} } as ExecutionContext
    return createApp().request(path, { method: 'POST', ...req }, e, ctx)
  }

  it('rejects a missing or invalid signature with 403', async () => {
    const e = env()
    const missing = await createApp().request('/api/voice/voicemail?orgId=o1&flowId=f1&callSid=CAdryrun_1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(vmParams()).toString(),
    }, e)
    expect(missing.status).toBe(403)
    const invalid = await createApp().request('/api/voice/voicemail?orgId=o1&flowId=f1&callSid=CAdryrun_1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'wrong' }, body: new URLSearchParams(vmParams()).toString(),
    }, e)
    expect(invalid.status).toBe(403)
  })

  it('a non-completed status is a 204 no-op: nothing written', async () => {
    const r2 = fakeR2()
    const e = env(r2.bucket)
    const res = await postVoicemail(e, 'orgId=o1&flowId=f1&callSid=CAdryrun_1', vmParams({ RecordingStatus: 'in-progress' }))
    expect(res.status).toBe(204)
    expect(r2.store.size).toBe(0)
    expect((e.DB as unknown as { voicemailsStore: unknown[] }).voicemailsStore.length).toBe(0)
  })

  it('a completed callback writes the audio to R2, a cc_voicemails row, and hands off transcription', async () => {
    const r2 = fakeR2()
    const e = env(r2.bucket)
    const waited: Promise<unknown>[] = []
    const res = await postVoicemail(e, 'orgId=o1&flowId=f1&callSid=CAdryrun_1', vmParams(), waited)
    expect(res.status).toBe(204)

    const key = 'orgs/o1/voicemails/CAdryrun_1/REdryrun_x.mp3'
    expect(r2.store.has(key)).toBe(true)
    expect(new TextDecoder().decode(r2.store.get(key)!)).toBe('dryrun-audio:REdryrun_x')

    const rows = (e.DB as unknown as { voicemailsStore: Record<string, unknown>[] }).voicemailsStore
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({
      organization_id: 'o1', flow_id: 'f1', twilio_call_sid: 'CAdryrun_1', from_e164: '+15551234567',
      r2_key: key, duration_s: 30,
    })

    // The 204 was returned BEFORE transcription finished; awaiting the handed-off promise completes it.
    expect(waited.length).toBe(1)
    await Promise.all(waited)
    expect(rows[0]).toMatchObject({ transcript_status: 'done', transcript_r2_key: 'orgs/o1/voicemails/CAdryrun_1/REdryrun_x.transcript.json' })
    expect(r2.store.has('orgs/o1/voicemails/CAdryrun_1/REdryrun_x.transcript.json')).toBe(true)
  })

  it('an unknown flowId still stores the voicemail, just without the flow attribution', async () => {
    const r2 = fakeR2()
    const e = env(r2.bucket)
    const res = await postVoicemail(e, 'orgId=o1&flowId=f_missing&callSid=CAdryrun_1', vmParams())
    expect(res.status).toBe(204)
    const rows = (e.DB as unknown as { voicemailsStore: Record<string, unknown>[] }).voicemailsStore
    expect(rows[0]).toMatchObject({ flow_id: null })
  })
})
