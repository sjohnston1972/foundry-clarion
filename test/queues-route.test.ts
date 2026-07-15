import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) => {
    const c = req.headers.get('cookie') ?? ''
    if (c.includes('fnd_session=agent')) return { sub: 'u-agent', email: 'agent@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=supervisor')) return { sub: 'u-sup', email: 'sup@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=admin')) return { sub: 'u-admin', email: 'boss@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'owner', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    return null
  }),
}))

import { createApp } from '../server/app'

// clarionRole is fixed per test via a closure; null => owner/admin JWT role bootstraps to 'admin'.
function fakeDb(clarionRole: 'agent' | 'supervisor' | null) {
  const queues: Record<string, unknown>[] = []
  const members: Record<string, unknown>[] = []
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return clarionRole ? { clarion_role: clarionRole } : null
            if (sql.includes('FROM cc_queues')) return queues.find((q) => q.organization_id === a[0] && q.id === a[1]) ?? null
            return null
          },
          async all() {
            if (sql.includes('FROM cc_queues')) return { results: queues.filter((q) => q.organization_id === a[0]) }
            if (sql.includes('FROM cc_queue_members')) return { results: members.filter((m) => m.queue_id === a[0]) }
            return { results: [] }
          },
          async run() {
            if (sql.startsWith('INSERT INTO cc_queues')) {
              queues.push({ id: a[0], organization_id: a[1], name: a[2], twilio_workflow_sid: a[3], strategy: a[4] })
            }
            if (sql.startsWith('INSERT INTO cc_queue_members')) {
              members.push({ queue_id: a[0], agent_id: a[1], priority: a[2] })
            }
            return {}
          },
        }),
      }
    },
  } as unknown as D1Database
}

const env = (clarionRole: 'agent' | 'supervisor' | null) => ({ DB: fakeDb(clarionRole), AUTH_ENFORCE: 'true', TWILIO_DRY_RUN: 'true' })

afterEach(() => vi.unstubAllGlobals())

describe('queues route — role gates', () => {
  it('agent gets 403 on create', async () => {
    const res = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=agent', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Support' }),
    }, env('agent'))
    expect(res.status).toBe(403)
  })
  it('agent gets 403 on list (needs supervisor+)', async () => {
    const res = await createApp().request('/api/queues', { headers: { cookie: 'fnd_session=agent' } }, env('agent'))
    expect(res.status).toBe(403)
  })
  it('supervisor gets 403 on create (needs admin)', async () => {
    const res = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=supervisor', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Support' }),
    }, env('supervisor'))
    expect(res.status).toBe(403)
  })
  it('supervisor can list', async () => {
    const res = await createApp().request('/api/queues', { headers: { cookie: 'fnd_session=supervisor' } }, env('supervisor'))
    expect(res.status).toBe(200)
  })
})

describe('queues route — create (dry-run)', () => {
  it('creates a queue with a dry-run WW sid and makes no network call to Twilio', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('network should not be called in dry-run') })
    vi.stubGlobal('fetch', fetchSpy)

    const res = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Support' }),
    }, env(null))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.name).toBe('Support')
    expect(String(body.data.twilioWorkflowSid)).toMatch(/^WWdryrun_/)

    for (const call of fetchSpy.mock.calls) {
      const url = String(call[0])
      expect(url).not.toContain('taskrouter.twilio.com')
    }
  })
  it('rejects an empty name', async () => {
    const res = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    }, env(null))
    expect(res.status).toBe(400)
  })
})
