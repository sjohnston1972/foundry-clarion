import { Hono } from 'hono'
import type { Env } from '../types'

export const health = new Hono<Env>()

health.get('/', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ success: true, status: 'healthy', database: 'connected', timestamp: new Date().toISOString() })
  } catch (e) {
    return c.json({ success: false, status: 'unhealthy', database: 'disconnected', error: (e as Error).message }, 503)
  }
})
