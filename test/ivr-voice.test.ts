import { describe, it, expect } from 'vitest'
import { createApp } from '../server/app'
import { computeTwilioSignature } from '../server/lib/twilio/signature'
import type { IvrFlowDefinition } from '../server/lib/ivr/graph'

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

function fakeDb() {
  const flows: Record<string, unknown>[] = [
    { id: 'f1', organization_id: 'o1', name: 'Main IVR', status: 'active', definition_json: JSON.stringify(flowDef), updated_at: 1000 },
  ]
  const queues: Record<string, unknown>[] = [
    { id: 'q_123', organization_id: 'o1', name: 'Sales', twilio_workflow_sid: 'WWtest123', strategy: 'longest-idle' },
  ]
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_ivr_flows')) return flows.find((f) => f.organization_id === a[0] && f.id === a[1]) ?? null
            if (sql.includes('FROM cc_queues')) return queues.find((q) => q.organization_id === a[0] && q.id === a[1]) ?? null
            if (sql.includes('FROM cc_org_settings')) return null // recording off (default posture)
            return null
          },
        }),
      }
    },
  } as unknown as D1Database
}

const env = () => ({ DB: fakeDb(), TWILIO_AUTH_TOKEN: AUTH_TOKEN })

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
