import { Hono } from 'hono'
import type { Env } from '../types'
import type { Bindings } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import type { PresenceEvent } from '../realtime/presence'

// Address the caller's org DO and forward a request to it.
function orgStub(env: Bindings, orgId: string) {
  const id = env.REALTIME.idFromName(orgId)
  return env.REALTIME.get(id)
}

export async function pushPresence(env: Bindings, orgId: string, event: PresenceEvent): Promise<void> {
  try {
    await orgStub(env, orgId).fetch('https://do/presence', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
    })
  } catch (e) {
    console.warn('pushPresence failed', orgId, (e as Error).message)
  }
}

export const realtime = new Hono<Env>()

// GET /api/realtime/socket — upgrade to the org's realtime hub (agent+).
realtime.get('/socket', requireClarionRole('agent'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  if (c.req.header('Upgrade') !== 'websocket') return err(c, 'expected_ws', 'Expected a WebSocket upgrade', 426)
  return orgStub(c.env, orgId).fetch(new Request('https://do/socket', c.req.raw))
})
