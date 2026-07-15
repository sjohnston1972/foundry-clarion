import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import type { Env } from '../types'
import { err } from '../lib/http'
import { mintDevSession } from '../lib/dev-auth'

/** Dev-only session minting. Reachable ONLY when DEV_AUTH === 'true' (guard in app.ts). */
export const dev = new Hono<Env>()

dev.post('/session', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { email?: unknown; orgId?: unknown; role?: unknown }
    | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const orgId = typeof body?.orgId === 'string' ? body.orgId.trim() : ''
  const role = typeof body?.role === 'string' && body.role ? body.role : 'owner'
  if (!email || !orgId) return err(c, 'invalid_input', 'email and orgId are required')

  const token = await mintDevSession({
    sub: `dev-${email}`,
    email,
    org_id: orgId,
    org_slug: 'dev',
    role,
  })
  setCookie(c, 'fnd_session', token, { path: '/', httpOnly: true, sameSite: 'Lax' })
  return c.json({ success: true, data: { email, orgId, role, token } })
})
