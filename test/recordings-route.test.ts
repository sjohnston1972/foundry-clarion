import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) => {
    const c = req.headers.get('cookie') ?? ''
    if (c.includes('fnd_session=agent')) return { sub: 'u-agent', email: 'agent@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=supervisor-b')) return { sub: 'u-sup-b', email: 'sup@beta.com', email_verified: true, org_id: 'o2', org_slug: 'beta', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=supervisor')) return { sub: 'u-sup', email: 'sup@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    return null
  }),
}))

import { createApp } from '../server/app'

// Two org-o1 recordings: rec1 transcribed, rec2 still pending.
const RECORDINGS: Record<string, unknown>[] = [
  { id: 'rec1', organization_id: 'o1', call_id: 'c1', twilio_recording_sid: 'RE1', r2_key: 'orgs/o1/calls/CA1/RE1.mp3', duration_s: 42, transcript_r2_key: 'orgs/o1/calls/CA1/RE1.transcript.json', transcript_status: 'done' },
  { id: 'rec2', organization_id: 'o1', call_id: 'c2', twilio_recording_sid: 'RE2', r2_key: 'orgs/o1/calls/CA2/RE2.mp3', duration_s: 10, transcript_r2_key: null, transcript_status: 'pending' },
]

function fakeDb(clarionRole: 'agent' | 'supervisor' | null) {
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return clarionRole ? { clarion_role: clarionRole } : null
            if (sql.includes('FROM cc_recordings')) return RECORDINGS.find((r) => r.organization_id === a[0] && r.id === a[1]) ?? null
            return null
          },
          async run() { return {} },
          async all() {
            if (sql.includes('FROM cc_recordings')) return { results: RECORDINGS.filter((r) => r.organization_id === a[0] && r.call_id === a[1]) }
            return { results: [] }
          },
        }),
      }
    },
  } as unknown as D1Database
}

function fakeR2(seed: Record<string, string>) {
  const store = new Map(Object.entries(seed))
  return {
    get: async (k: string) => (store.has(k) ? { body: store.get(k)! } : null),
  } as unknown as R2Bucket
}

const R2_SEED = {
  'orgs/o1/calls/CA1/RE1.mp3': 'audio-bytes-re1',
  'orgs/o1/calls/CA1/RE1.transcript.json': JSON.stringify({ text: '[dry-run transcript]', model: 'dryrun', dryRun: true }),
  'orgs/o1/calls/CA2/RE2.mp3': 'audio-bytes-re2',
}

const env = (clarionRole: 'agent' | 'supervisor' | null) => ({
  DB: fakeDb(clarionRole), RECORDINGS: fakeR2(R2_SEED), AUTH_ENFORCE: 'true',
})

const get = (path: string, cookie: string, role: 'agent' | 'supervisor' | null = 'supervisor') =>
  createApp().request(path, { headers: { cookie } }, env(role))

describe('recordings routes — media + transcript', () => {
  it('agent gets 403 on both endpoints', async () => {
    expect((await get('/api/recordings/rec1/media', 'fnd_session=agent', 'agent')).status).toBe(403)
    expect((await get('/api/recordings/rec1/transcript', 'fnd_session=agent', 'agent')).status).toBe(403)
  })

  it('supervisor streams the audio: 200, audio/mpeg, private no-store', async () => {
    const res = await get('/api/recordings/rec1/media', 'fnd_session=supervisor')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('audio/mpeg')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.text()).toBe('audio-bytes-re1')
  })

  it("cross-tenant: org B fetching org A's recording id gets 404, not 403", async () => {
    const media = await get('/api/recordings/rec1/media', 'fnd_session=supervisor-b')
    expect(media.status).toBe(404)
    const transcript = await get('/api/recordings/rec1/transcript', 'fnd_session=supervisor-b')
    expect(transcript.status).toBe(404)
  })

  it('a pending transcript is a 404', async () => {
    const res = await get('/api/recordings/rec2/transcript', 'fnd_session=supervisor')
    expect(res.status).toBe(404)
  })

  it('lists a call\'s recordings for a supervisor; cross-org callId yields []', async () => {
    const own = await get('/api/recordings?callId=c1', 'fnd_session=supervisor')
    expect(own.status).toBe(200)
    const rows = (await own.json()).data
    expect(rows.length).toBe(1)
    expect(rows[0]).toMatchObject({ id: 'rec1', transcriptStatus: 'done' })

    const crossOrg = await get('/api/recordings?callId=c1', 'fnd_session=supervisor-b')
    expect(crossOrg.status).toBe(200)
    expect((await crossOrg.json()).data).toEqual([])

    expect((await get('/api/recordings?callId=c1', 'fnd_session=agent', 'agent')).status).toBe(403)
    expect((await get('/api/recordings', 'fnd_session=supervisor')).status).toBe(400)
  })

  it('a done transcript returns the JSON with private no-store', async () => {
    const res = await get('/api/recordings/rec1/transcript', 'fnd_session=supervisor')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    expect(await res.json()).toMatchObject({ text: '[dry-run transcript]', dryRun: true })
  })
})
