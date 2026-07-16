import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'

export const me = new Hono<Env>()

me.get('/', (c) => {
  const user = c.get('user')
  if (!user) return err(c, 'unauthenticated', 'Sign in required', 401)
  return c.json({ success: true, data: {
    user, orgId: c.get('organizationId'), orgRole: c.get('role') ?? null, clarionRole: c.get('clarionRole'),
  } })
})
