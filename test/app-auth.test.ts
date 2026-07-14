import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) => {
    const cookie = req.headers.get('cookie') ?? ''
    return cookie.includes('fnd_session=good')
      ? { sub: 'u1', email: 'a@b.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'owner', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
      : null
  }),
}))

import { createApp } from '../server/app'

function fakeDb() {
  const store: Record<string, string> = {}
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return store['role'] ? { clarion_role: store['role'] } : null
            return { ok: 1 }
          },
          async run() { if (sql.startsWith('INSERT INTO cc_members')) store['role'] = String(a[2]); return {} },
        }),
        async first() { return { ok: 1 } },
      }
    },
  } as unknown as D1Database
}

const env = { DB: fakeDb(), AUTH_ENFORCE: 'true' }

describe('auth gate', () => {
  it('auth-status is public and reports logged-out', async () => {
    const res = await createApp().request('/api/auth-status', {}, env)
    expect(res.status).toBe(200)
    expect((await res.json()).data.authenticated).toBe(false)
  })
  it('/api/me 401s without a session when enforcing', async () => {
    const res = await createApp().request('/api/me', { headers: { 'X-Requested-With': 'fetch' } }, env)
    expect(res.status).toBe(401)
  })
  it('/api/me returns identity + admin (owner bootstrap) with a good session', async () => {
    const res = await createApp().request('/api/me', { headers: { cookie: 'fnd_session=good' } }, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ user: { id: 'u1', email: 'a@b.com' }, orgId: 'o1', clarionRole: 'admin' })
  })
})
