import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) => {
    const c = req.headers.get('cookie') ?? ''
    if (c.includes('fnd_session=owner')) return { sub: 'u1', email: 'boss@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'owner', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    return null
  }),
}))

import { createApp } from '../server/app'

// DB: records cc_agents inserts; cc_members returns admin for the owner bootstrap; skills upserts are no-ops.
function fakeDb() {
  const agents: Record<string, unknown>[] = []
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return null // -> owner bootstrap to admin
            if (sql.includes('FROM cc_agents') && sql.includes('email')) return agents.find((x) => x.email === a[1]) ?? null
            if (sql.includes('FROM cc_skills')) return null
            return null
          },
          async all() {
            if (sql.includes('FROM cc_agents')) return { results: agents }
            return { results: [] }
          },
          async run() {
            if (sql.startsWith('INSERT INTO cc_agents')) agents.push({ id: a[0], organization_id: a[1], email: a[3], twilio_worker_sid: a[5], status: 'offline', activity_sid: null, user_id: a[2], workspace_resource_id: a[4] })
            return {}
          },
        }),
      }
    },
  } as unknown as D1Database
}

// WORKSPACE_DB: one resource 'agent@acme.com' with one skill.
function fakeWorkspaceDb() {
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('lower(r.email) =') && a[1] === 'agent@acme.com') return { id: 'r1', name: 'Agent A', email: 'agent@acme.com', job_role: 'Support' }
            return null
          },
          async all() {
            if (sql.includes('resource_sub_skills')) return { results: [{ sub_skill_id: 7, name: 'Billing', level: 4 }] }
            if (sql.includes('FROM resources')) return { results: [{ id: 'r1', name: 'Agent A', email: 'agent@acme.com', job_role: 'Support' }] }
            return { results: [] }
          },
        }),
      }
    },
  } as unknown as D1Database
}

const env = () => ({ DB: fakeDb(), WORKSPACE_DB: fakeWorkspaceDb(), AUTH_ENFORCE: 'true', TWILIO_DRY_RUN: 'true' })

describe('enable-as-agent', () => {
  it('401s a request with no session', async () => {
    const res = await createApp().request('/api/agents', { headers: { 'X-Requested-With': 'fetch' } }, env())
    expect(res.status).toBe(401)
  })
  it('enables a Workspace resource as an agent (DRY_RUN worker sid)', async () => {
    const app = createApp(); const e = env()
    const res = await app.request('/api/agents/enable', {
      method: 'POST', headers: { cookie: 'fnd_session=owner', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'agent@acme.com' }),
    }, e)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.email).toBe('agent@acme.com')
    expect(String(body.data.twilioWorkerSid)).toMatch(/^WKdryrun_/)
  })
  it('404s when no Workspace resource matches the email', async () => {
    const res = await createApp().request('/api/agents/enable', {
      method: 'POST', headers: { cookie: 'fnd_session=owner', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@acme.com' }),
    }, env())
    expect(res.status).toBe(404)
  })
})
