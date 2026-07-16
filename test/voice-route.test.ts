import { describe, it, expect, vi, beforeEach } from 'vitest'

// Spy-wrap the REAL provisioning module: dry-run behaviour is preserved (the actual
// implementation runs), but tests can assert whether and how startCallRecording was
// invoked by the status webhook.
vi.mock('../server/lib/twilio/provisioning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../server/lib/twilio/provisioning')>()
  return { ...actual, startCallRecording: vi.fn(actual.startCallRecording) }
})

import { createApp } from '../server/app'
import { computeTwilioSignature } from '../server/lib/twilio/signature'
import { DEFAULT_ANNOUNCEMENT } from '../server/db/settings'
import { startCallRecording } from '../server/lib/twilio/provisioning'

const AUTH_TOKEN = 'test-auth-token'
const BASE_URL = 'http://localhost'

type FakeSettings = { recording_enabled: number; announcement_text: string | null }

function fakeDb(settings?: FakeSettings) {
  const queues: Record<string, unknown>[] = [{ id: 'q1', organization_id: 'o1', name: 'Support', twilio_workflow_sid: 'WWabc123', strategy: 'longest-idle' }]
  const calls: Record<string, unknown>[] = []
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_queues')) return queues.find((q) => q.organization_id === a[0] && q.id === a[1]) ?? null
            if (sql.includes('FROM cc_calls')) return calls.find((c) => c.organization_id === a[0] && c.twilio_call_sid === a[1]) ?? null
            if (sql.includes('FROM cc_org_settings')) return settings && a[0] === 'o1' ? { organization_id: 'o1', ...settings } : null
            return null
          },
          async run() {
            if (sql.startsWith('INSERT INTO cc_calls')) {
              calls.push({ id: a[0], organization_id: a[1], twilio_call_sid: a[2], from_e164: a[3], to_e164: a[4], queue_id: a[5], agent_id: null, disposition: null, duration_s: null })
            }
            if (sql.startsWith('UPDATE cc_calls')) {
              const row = calls.find((c) => c.organization_id === a[3] && c.twilio_call_sid === a[4])
              if (row) { row.disposition = a[0]; row.duration_s = a[1]; row.agent_id = a[2] }
            }
            return {}
          },
        }),
      }
    },
  } as unknown as D1Database
}

function fakeRealtime(seen: Request[]) {
  const stub = { fetch: async (input: RequestInfo, init?: RequestInit) => { seen.push(typeof input === 'string' ? new Request(input, init) : input); return new Response('ok') } }
  return { idFromName: (_n: string) => ({ toString: () => 'id' }), get: (_id: unknown) => stub } as unknown as DurableObjectNamespace
}

const env = (seen: Request[], settings?: FakeSettings) => ({ DB: fakeDb(settings), REALTIME: fakeRealtime(seen), TWILIO_AUTH_TOKEN: AUTH_TOKEN })

async function signedRequest(path: string, params: Record<string, string>) {
  const url = `${BASE_URL}${path}`
  const signature = await computeTwilioSignature(AUTH_TOKEN, url, params)
  return { headers: { 'X-Twilio-Signature': signature, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() }
}

describe('voice webhooks — signature validation', () => {
  it('rejects a missing signature with 403', async () => {
    const res = await createApp().request('/api/voice/inbound?orgId=o1&queueId=q1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ From: '+15551234567', To: '+15557654321' }).toString(),
    }, env([]))
    expect(res.status).toBe(403)
  })

  it('rejects an invalid signature with 403', async () => {
    const res = await createApp().request('/api/voice/inbound?orgId=o1&queueId=q1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'not-the-real-signature' },
      body: new URLSearchParams({ From: '+15551234567', To: '+15557654321' }).toString(),
    }, env([]))
    expect(res.status).toBe(403)
  })

  it('accepts a valid signature and returns TwiML enqueueing to the queue\'s Workflow', async () => {
    const params = { From: '+15551234567', To: '+15557654321' }
    const req = await signedRequest('/api/voice/inbound?orgId=o1&queueId=q1', params)
    const res = await createApp().request('/api/voice/inbound?orgId=o1&queueId=q1', { method: 'POST', ...req }, env([]))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/xml')
    const body = await res.text()
    expect(body).toContain('<Enqueue workflowSid="WWabc123">')
    expect(body).toContain('<Response>')
  })
})

describe('voice inbound — the consent invariant (Steven, 2026-07-16)', () => {
  const params = { From: '+15551234567', To: '+15557654321' }
  const post = async (settings?: FakeSettings) => {
    const req = await signedRequest('/api/voice/inbound?orgId=o1&queueId=q1', params)
    const res = await createApp().request('/api/voice/inbound?orgId=o1&queueId=q1', { method: 'POST', ...req }, env([], settings))
    expect(res.status).toBe(200)
    return res.text()
  }

  it('consent invariant: recording off => no announcement, no recording', async () => {
    // Explicitly disabled, and (the default posture) no settings row at all.
    for (const body of [await post({ recording_enabled: 0, announcement_text: 'ignored' }), await post(undefined)]) {
      expect(body).not.toContain('<Say>')
      // Byte-for-byte the Phase 3 shape: <Response> straight into <Enqueue>.
      expect(body).toContain('<Response><Enqueue workflowSid="WWabc123">')
    }
  })

  it("recording on => <Say> with the org's own wording", async () => {
    const body = await post({ recording_enabled: 1, announcement_text: 'Custom org announcement.' })
    expect(body).toContain('<Say>Custom org announcement.</Say>')
    expect(body.indexOf('<Say>')).toBeLessThan(body.indexOf('<Enqueue'))
  })

  it('recording on with NULL wording => <Say> carries the default announcement', async () => {
    const body = await post({ recording_enabled: 1, announcement_text: null })
    expect(body).toContain(`<Say>${DEFAULT_ANNOUNCEMENT}</Say>`)
  })
})

describe('voice status webhook — cc_calls + DO push', () => {
  it('writes a cc_calls row and pushes an event to the org DO', async () => {
    const seen: Request[] = []
    const params = { CallSid: 'CAdryrun_1', From: '+15551234567', To: '+15557654321', CallStatus: 'completed', CallDuration: '42' }
    const req = await signedRequest('/api/voice/status?orgId=o1&queueId=q1', params)
    const res = await createApp().request('/api/voice/status?orgId=o1&queueId=q1', { method: 'POST', ...req }, env(seen))
    expect(res.status).toBe(204)
    expect(seen.some((r) => r.url.endsWith('/presence'))).toBe(true)
  })

  it('rejects a status update with a missing signature', async () => {
    const params = { CallSid: 'CAdryrun_2', CallStatus: 'ringing' }
    const res = await createApp().request('/api/voice/status?orgId=o1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    }, env([]))
    expect(res.status).toBe(403)
  })
})

describe('voice status webhook — recording start (dry-run)', () => {
  beforeEach(() => {
    vi.mocked(startCallRecording).mockClear()
  })

  const postStatus = async (settings?: FakeSettings, callStatus = 'in-progress') => {
    const params = { CallSid: 'CAdryrun_rec', From: '+15551234567', To: '+15557654321', CallStatus: callStatus }
    const req = await signedRequest('/api/voice/status?orgId=o1&queueId=q1', params)
    return createApp().request('/api/voice/status?orgId=o1&queueId=q1', { method: 'POST', ...req }, env([], settings))
  }

  it('does not start recording when disabled or unconfigured (the consent invariant)', async () => {
    expect((await postStatus({ recording_enabled: 0, announcement_text: null })).status).toBe(204)
    expect((await postStatus(undefined)).status).toBe(204)
    expect(startCallRecording).not.toHaveBeenCalled()
  })

  it('starts recording when enabled — callback carries orgId, dry-run SID, no fetch to api.twilio.com', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('network must not be called in dry-run') })
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const res = await postStatus({ recording_enabled: 1, announcement_text: null })
      expect(res.status).toBe(204)
      expect(startCallRecording).toHaveBeenCalledTimes(1)

      const args = vi.mocked(startCallRecording).mock.calls[0][1]
      expect(args.callSid).toBe('CAdryrun_rec')
      const cb = new URL(args.recordingStatusCallback)
      expect(cb.pathname).toBe('/api/voice/recording')
      expect(cb.searchParams.get('orgId')).toBe('o1')

      const out = await vi.mocked(startCallRecording).mock.results[0].value
      expect(out.recordingSid).toMatch(/^REdryrun_/)
      expect(out.dryRun).toBe(true)

      for (const call of fetchSpy.mock.calls) {
        expect(String(call[0])).not.toContain('api.twilio.com')
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('a non-in-progress status never starts recording, even when enabled', async () => {
    expect((await postStatus({ recording_enabled: 1, announcement_text: null }, 'completed')).status).toBe(204)
    expect(startCallRecording).not.toHaveBeenCalled()
  })
})
