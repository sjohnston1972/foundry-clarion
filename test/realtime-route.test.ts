import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) =>
    (req.headers.get('cookie') ?? '').includes('fnd_session=agent')
      ? { sub: 'u9', email: 'agent@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
      : null),
}))

import { createApp } from '../server/app'

// Node's fetch (undici) rejects constructing a Response with status 101 outside a
// real protocol upgrade ("init[\"status\"] must be in the range of 200 to 599").
// workerd allows it for WS upgrades; here we synthesize a real Response instance
// and shadow its status so the test can assert on it without the constructor throwing.
function wsUpgradeResponse(): Response {
  const res = new Response(null, { status: 200 })
  Object.defineProperty(res, 'status', { value: 101, configurable: true })
  return res
}

// DurableObjectStub.fetch is overloaded: fetch(request: Request) OR fetch(url: string, init?).
// pushPresence uses the (url, init) form, so the stub must normalize both into a Request
// the way the real binding does, or callers using the string form silently produce a
// Request with `url: undefined`.
function fakeRealtime(seen: Request[]) {
  const stub = {
    fetch: async (input: RequestInfo, init?: RequestInit) => {
      seen.push(typeof input === 'string' ? new Request(input, init) : input)
      return wsUpgradeResponse()
    },
  }
  return { idFromName: (_n: string) => ({ toString: () => 'id' }), get: (_id: unknown) => stub } as unknown as DurableObjectNamespace
}

// cc_members returns 'agent' for this user; cc_agents has the caller.
function fakeDb() {
  return {
    prepare(sql: string) {
      return { bind: (..._a: unknown[]) => ({
        async first() {
          if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
          if (sql.includes('FROM cc_members')) return { clarion_role: 'agent' }
          if (sql.includes('FROM cc_agents')) return { id: 'a1', organization_id: 'o1', email: 'agent@acme.com', twilio_worker_sid: 'WKdryrun_1', status: 'offline', activity_sid: null, user_id: 'u9', workspace_resource_id: 'r1' }
          return null
        },
        async run() { return {} }, async all() { return { results: [] } },
      }) }
    },
  } as unknown as D1Database
}

describe('realtime + status push', () => {
  it('forwards a WS upgrade to the org DO', async () => {
    const seen: Request[] = []
    const res = await createApp().request('/api/realtime/socket', { headers: { cookie: 'fnd_session=agent', Upgrade: 'websocket' } }, { DB: fakeDb(), REALTIME: fakeRealtime(seen), AUTH_ENFORCE: 'true' })
    expect(res.status).toBe(101)
    expect(seen.length).toBe(1)
  })
  it('status change pushes a presence event to the DO', async () => {
    const seen: Request[] = []
    const res = await createApp().request('/api/agents/status', {
      method: 'POST', headers: { cookie: 'fnd_session=agent', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'available' }),
    }, { DB: fakeDb(), REALTIME: fakeRealtime(seen), AUTH_ENFORCE: 'true' })
    expect(res.status).toBe(200)
    expect(seen.some((r) => r.url.endsWith('/presence'))).toBe(true)
  })
})
