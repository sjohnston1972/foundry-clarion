import { describe, it, expect, vi, afterEach } from 'vitest'
import { createApp } from '../server/app'
import { mintDevSession } from '../server/lib/dev-auth'

// NO vi.mock('@foundry/auth') here — these tests exercise the REAL verify path.

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

function baseEnv(extra: Record<string, string> = {}) {
  return { DB: fakeDb(), AUTH_ENFORCE: 'true', ...extra }
}

const claims = { sub: 'dev-u1', email: 'dev@example.com', org_id: 'org-dev', org_slug: 'dev', role: 'owner' }

afterEach(() => vi.unstubAllGlobals())

describe('dev auth (DEV_AUTH gate)', () => {
  it("DEV_AUTH='true': a minted token resolves a session and /api/me returns 200", async () => {
    const token = await mintDevSession(claims)
    const res = await createApp().request(
      '/api/me',
      { headers: { cookie: `fnd_session=${token}` } },
      baseEnv({ DEV_AUTH: 'true' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ user: { email: 'dev@example.com' }, orgId: 'org-dev', clarionRole: 'admin' })
  })

  it('DEV_AUTH unset: the same minted token is rejected and /api/dev/session is 404', async () => {
    // Kill outbound network so the remote-JWKS path fails fast instead of calling AuthPak.
    vi.stubGlobal('fetch', async () => { throw new Error('network disabled in test') })
    const token = await mintDevSession(claims)
    const me = await createApp().request(
      '/api/me',
      { headers: { cookie: `fnd_session=${token}`, 'X-Requested-With': 'fetch' } },
      baseEnv(),
    )
    expect(me.status).toBe(401)
    const sess = await createApp().request(
      '/api/dev/session',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', orgId: 'o1', role: 'owner' }) },
      baseEnv(),
    )
    expect(sess.status).toBe(404)
  })

  it("DEV_AUTH='false': same rejection as unset", async () => {
    vi.stubGlobal('fetch', async () => { throw new Error('network disabled in test') })
    const token = await mintDevSession(claims)
    const me = await createApp().request(
      '/api/me',
      { headers: { cookie: `fnd_session=${token}`, 'X-Requested-With': 'fetch' } },
      baseEnv({ DEV_AUTH: 'false' }),
    )
    expect(me.status).toBe(401)
    const sess = await createApp().request(
      '/api/dev/session',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@b.c', orgId: 'o1', role: 'owner' }) },
      baseEnv({ DEV_AUTH: 'false' }),
    )
    expect(sess.status).toBe(404)
  })
})
