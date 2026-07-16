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
import { transcribeRecording } from '../server/lib/ai/transcribe'
import type { Bindings } from '../server/types'

const AUTH_TOKEN = 'test-auth-token'
const BASE_URL = 'http://localhost'

type FakeSettings = { recording_enabled: number; announcement_text: string | null }
type FakeDbHandle = D1Database & { recordingsStore: Record<string, unknown>[] }

function fakeDb(settings?: FakeSettings): FakeDbHandle {
  const queues: Record<string, unknown>[] = [{ id: 'q1', organization_id: 'o1', name: 'Support', twilio_workflow_sid: 'WWabc123', strategy: 'longest-idle' }]
  const calls: Record<string, unknown>[] = []
  const recordings: Record<string, unknown>[] = []
  const db = {
    recordingsStore: recordings,
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
            if (sql.startsWith('INSERT INTO cc_recordings')) {
              recordings.push({ id: a[0], organization_id: a[1], call_id: a[2], twilio_recording_sid: a[3], r2_key: a[4], duration_s: a[5], transcript_r2_key: null, transcript_status: 'pending' })
            }
            if (sql.startsWith('UPDATE cc_recordings')) {
              const row = recordings.find((r) => r.organization_id === a[2] && r.id === a[3])
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
      get: async (k: string) => store.has(k)
        ? { arrayBuffer: async () => store.get(k)!, body: null }
        : null,
    } as unknown as R2Bucket,
    store,
  }
}

function fakeRealtime(seen: Request[]) {
  const stub = { fetch: async (input: RequestInfo, init?: RequestInit) => { seen.push(typeof input === 'string' ? new Request(input, init) : input); return new Response('ok') } }
  return { idFromName: (_n: string) => ({ toString: () => 'id' }), get: (_id: unknown) => stub } as unknown as DurableObjectNamespace
}

const env = (seen: Request[], settings?: FakeSettings, r2?: R2Bucket) => ({
  DB: fakeDb(settings), REALTIME: fakeRealtime(seen), TWILIO_AUTH_TOKEN: AUTH_TOKEN,
  RECORDINGS: r2 ?? fakeR2().bucket,
})

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

describe('voice recording webhook — LINCHPIN: callback → R2 + cc_recordings', () => {
  const recParams = (over: Record<string, string> = {}) => ({
    CallSid: 'CAdryrun_1', RecordingSid: 'REdryrun_x', RecordingStatus: 'completed',
    RecordingDuration: '42', RecordingUrl: 'https://api.twilio.com/fake/REdryrun_x', ...over,
  })

  // Seed the cc_calls row the callback looks up, via the status webhook on the SAME env.
  const seedCall = async (e: ReturnType<typeof env>) => {
    const params = { CallSid: 'CAdryrun_1', From: '+15551234567', To: '+15557654321', CallStatus: 'completed', CallDuration: '42' }
    const req = await signedRequest('/api/voice/status?orgId=o1&queueId=q1', params)
    const res = await createApp().request('/api/voice/status?orgId=o1&queueId=q1', { method: 'POST', ...req }, e)
    expect(res.status).toBe(204)
  }

  // The /recording handler hands transcription to c.executionCtx.waitUntil, so the
  // test must supply an ExecutionContext; `waited` collects the handed-off promises.
  const postRecording = async (e: ReturnType<typeof env>, params: Record<string, string>, waited: Promise<unknown>[] = []) => {
    const ctx = { waitUntil: (p: Promise<unknown>) => { waited.push(p) }, passThroughOnException: () => {} } as ExecutionContext
    const req = await signedRequest('/api/voice/recording?orgId=o1', params)
    return createApp().request('/api/voice/recording?orgId=o1', { method: 'POST', ...req }, e, ctx)
  }

  it('rejects a missing or invalid signature with 403', async () => {
    const e = env([])
    const missing = await createApp().request('/api/voice/recording?orgId=o1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(recParams()).toString(),
    }, e)
    expect(missing.status).toBe(403)
    const invalid = await createApp().request('/api/voice/recording?orgId=o1', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': 'wrong' },
      body: new URLSearchParams(recParams()).toString(),
    }, e)
    expect(invalid.status).toBe(403)
  })

  it('a non-completed status is a 204 no-op: nothing written', async () => {
    const r2 = fakeR2()
    const e = env([], undefined, r2.bucket)
    await seedCall(e)
    const res = await postRecording(e, recParams({ RecordingStatus: 'in-progress' }))
    expect(res.status).toBe(204)
    expect(r2.store.size).toBe(0)
    expect((e.DB as FakeDbHandle).recordingsStore.length).toBe(0)
  })

  it('a completed callback writes the audio to R2, a cc_recordings row, and hands off transcription', async () => {
    const r2 = fakeR2()
    const e = env([], undefined, r2.bucket)
    await seedCall(e)
    const waited: Promise<unknown>[] = []
    const res = await postRecording(e, recParams(), waited)
    expect(res.status).toBe(204)

    const key = 'orgs/o1/calls/CAdryrun_1/REdryrun_x.mp3'
    expect(r2.store.has(key)).toBe(true)
    expect(new TextDecoder().decode(r2.store.get(key)!)).toBe('dryrun-audio:REdryrun_x')

    const rows = (e.DB as FakeDbHandle).recordingsStore
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({
      organization_id: 'o1', twilio_recording_sid: 'REdryrun_x', r2_key: key, duration_s: 42,
    })

    // The 204 was returned BEFORE transcription finished (Twilio never waits on
    // Whisper); awaiting the handed-off promise completes the pipeline.
    expect(waited.length).toBe(1)
    await Promise.all(waited)
    expect(rows[0]).toMatchObject({
      transcript_status: 'done',
      transcript_r2_key: 'orgs/o1/calls/CAdryrun_1/REdryrun_x.transcript.json',
    })
    expect(r2.store.has('orgs/o1/calls/CAdryrun_1/REdryrun_x.transcript.json')).toBe(true)
  })

  it('an unknown CallSid is a 404', async () => {
    const e = env([])
    const res = await postRecording(e, recParams({ CallSid: 'CA_unknown' }))
    expect(res.status).toBe(404)
  })
})

describe('transcribeRecording — R2 -> Whisper -> R2 + cc_recordings, never throws', () => {
  const KEY = 'orgs/o1/calls/CAdryrun_1/REdryrun_x.mp3'

  // A pending cc_recordings row + its (optional) audio object, assembled directly —
  // these tests call transcribeRecording itself, per the plan, rather than relying
  // on executionCtx plumbing.
  const setup = (over: Record<string, unknown> = {}, withAudio = true) => {
    const r2 = fakeR2()
    const db = fakeDb()
    db.recordingsStore.push({
      id: 'rec1', organization_id: 'o1', call_id: 'c1', twilio_recording_sid: 'REdryrun_x',
      r2_key: KEY, duration_s: 42, transcript_r2_key: null, transcript_status: 'pending',
    })
    if (withAudio) r2.store.set(KEY, new TextEncoder().encode('dryrun-audio:REdryrun_x').buffer as ArrayBuffer)
    const e = { DB: db, RECORDINGS: r2.bucket, ...over } as unknown as Bindings
    return { e, r2, row: db.recordingsStore[0] }
  }

  it("a successful run => 'done', a .transcript.json key, and the transcript object in R2", async () => {
    const { e, r2, row } = setup()
    await transcribeRecording(e, { orgId: 'o1', recordingId: 'rec1', r2Key: KEY })
    expect(row.transcript_status).toBe('done')
    expect(String(row.transcript_r2_key)).toBe('orgs/o1/calls/CAdryrun_1/REdryrun_x.transcript.json')
    const raw = r2.store.get('orgs/o1/calls/CAdryrun_1/REdryrun_x.transcript.json')
    expect(raw).toBeDefined()
    // transcribeRecording puts a JSON string; the fake store holds it verbatim.
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    expect(JSON.parse(text)).toMatchObject({ text: '[dry-run transcript]', dryRun: true })
  })

  it("a throwing transcribeAudio => 'failed', and the recording row + r2_key survive intact", async () => {
    // AI_DRY_RUN='false' with a throwing AI exercises the real catch path.
    const throwingAi = { run: async () => { throw new Error('whisper exploded') } } as unknown as Ai
    const { e, r2, row } = setup({ AI_DRY_RUN: 'false', AI: throwingAi })
    await expect(transcribeRecording(e, { orgId: 'o1', recordingId: 'rec1', r2Key: KEY })).resolves.toBeUndefined()
    expect(row.transcript_status).toBe('failed')
    expect(row.transcript_r2_key).toBeNull()
    // The recording itself is untouched: row present, key intact, audio still in R2.
    expect(row.r2_key).toBe(KEY)
    expect(r2.store.has(KEY)).toBe(true)
  })

  it("a missing R2 object => 'failed', no throw", async () => {
    const { e, row } = setup({}, /* withAudio */ false)
    await expect(transcribeRecording(e, { orgId: 'o1', recordingId: 'rec1', r2Key: KEY })).resolves.toBeUndefined()
    expect(row.transcript_status).toBe('failed')
    expect(row.transcript_r2_key).toBeNull()
  })
})
