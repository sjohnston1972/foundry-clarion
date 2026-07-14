import { Hono } from 'hono'
import type { Env } from './types'
import { apiOnError } from './lib/http'
import { health } from './routes/health'

export function createApp() {
  const app = new Hono<Env>().basePath('/api')
  app.onError(apiOnError)
  // Health works even when the DB is down / no session -> mount before middleware.
  app.route('/health', health)
  return app
}
