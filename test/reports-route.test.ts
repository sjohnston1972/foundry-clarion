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

// Seeded across two orgs. o2's call reuses o1's queue id (q1) on purpose — the
// cross-tenant test passes org A's queueId from an org B session.
const CALLS: Record<string, unknown>[] = [
  { id: 'c1', organization_id: 'o1', twilio_call_sid: 'CA1', from_e164: '+1', to_e164: '+2', queue_id: 'q1', agent_id: 'a1', disposition: 'completed', duration_s: 60, started_at: '2026-07-16T10:00:00' },
  { id: 'c2', organization_id: 'o1', twilio_call_sid: 'CA2', from_e164: '+1', to_e164: '+2', queue_id: 'q1', agent_id: null, disposition: 'no-answer', duration_s: null, started_at: '2026-07-16T11:00:00' },
  { id: 'c3', organization_id: 'o1', twilio_call_sid: 'CA3', from_e164: '+1', to_e164: '+2', queue_id: 'q2', agent_id: 'a2', disposition: 'completed', duration_s: 30, started_at: '2026-07-15T09:00:00' },
  { id: 'c4', organization_id: 'o2', twilio_call_sid: 'CA4', from_e164: '+3', to_e164: '+4', queue_id: 'q1', agent_id: 'a9', disposition: 'completed', duration_s: 10, started_at: '2026-07-16T12:00:00' },
]

// Interprets exactly the clause strings whereFor emits — bound values only.
function applyWhere(sql: string, binds: unknown[]): Record<string, unknown>[] {
  const wherePart = sql.slice(sql.indexOf('WHERE ') + 6).replace(/\s+ORDER BY[\s\S]*$/, '').trim()
  const clauses = wherePart.split(' AND ')
  return CALLS.filter((r) => clauses.every((clause, i) => {
    const v = binds[i]
    switch (clause) {
      case 'organization_id = ?': return r.organization_id === v
      case 'started_at >= ?': return String(r.started_at) >= String(v)
      case 'started_at <= ?': return String(r.started_at) <= String(v)
      case 'queue_id = ?': return r.queue_id === v
      case 'agent_id = ?': return r.agent_id === v
      case 'disposition = ?': return r.disposition === v
      default: return false
    }
  }))
}

function fakeDb(clarionRole: 'agent' | 'supervisor' | null) {
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return clarionRole ? { clarion_role: clarionRole } : null
            if (sql.includes('COUNT(*)') && sql.includes('FROM cc_calls')) {
              const rows = applyWhere(sql, a)
              const answered = rows.filter((r) => r.agent_id !== null).length
              const durations = rows.filter((r) => r.duration_s !== null).map((r) => Number(r.duration_s))
              return {
                total: rows.length,
                answered,
                abandoned: rows.length - answered,
                avg_duration_s: durations.length ? durations.reduce((s, d) => s + d, 0) / durations.length : 0,
              }
            }
            return null
          },
          async all() {
            if (sql.includes('FROM cc_calls')) return { results: applyWhere(sql, a) }
            return { results: [] }
          },
          async run() { return {} },
        }),
      }
    },
  } as unknown as D1Database
}

const env = (clarionRole: 'agent' | 'supervisor' | null) => ({ DB: fakeDb(clarionRole), AUTH_ENFORCE: 'true' })

const get = async (qs: string, cookie: string, role: 'agent' | 'supervisor' | null = 'supervisor') => {
  const res = await createApp().request(`/api/reports/calls${qs}`, { headers: { cookie } }, env(role))
  return { status: res.status, body: await res.json() }
}

describe('reports route', () => {
  it('agent gets 403', async () => {
    const { status } = await get('', 'fnd_session=agent', 'agent')
    expect(status).toBe(403)
  })

  it('supervisor gets 200 with rows + a correct unfiltered summary', async () => {
    const { status, body } = await get('', 'fnd_session=supervisor')
    expect(status).toBe(200)
    expect(body.data.calls.length).toBe(3)
    // AVG ignores NULL durations: (60 + 30) / 2 = 45.
    expect(body.data.summary).toEqual({ total: 3, answered: 2, abandoned: 1, avgDurationS: 45 })
  })

  it('each filter narrows the result set', async () => {
    expect((await get('?queueId=q1', 'fnd_session=supervisor')).body.data.calls.length).toBe(2)
    expect((await get('?agentId=a1', 'fnd_session=supervisor')).body.data.calls.length).toBe(1)
    expect((await get('?disposition=completed', 'fnd_session=supervisor')).body.data.calls.length).toBe(2)
    expect((await get('?from=2026-07-16T00:00:00', 'fnd_session=supervisor')).body.data.calls.length).toBe(2)
    expect((await get('?to=2026-07-15T23:59:59', 'fnd_session=supervisor')).body.data.calls.length).toBe(1)
    const combined = await get('?queueId=q1&disposition=completed', 'fnd_session=supervisor')
    expect(combined.body.data.calls.length).toBe(1)
    expect(combined.body.data.summary).toEqual({ total: 1, answered: 1, abandoned: 0, avgDurationS: 60 })
  })

  it("cross-tenant: org B never sees org A's calls, even when passing org A's queueId", async () => {
    const { status, body } = await get('?queueId=q1', 'fnd_session=supervisor-b')
    expect(status).toBe(200)
    expect(body.data.calls.length).toBe(1)
    expect(body.data.calls[0]).toMatchObject({ id: 'c4', organizationId: 'o2' })
    expect(body.data.summary.total).toBe(1)
  })
})
