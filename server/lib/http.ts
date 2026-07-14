import type { Context } from 'hono'

export function json<T>(c: Context, data: T, status = 200) {
  // `as never`: mirrors Workspace's http helper — Hono types the status as a
  // ContentfulStatusCode union, so a plain number needs this cast (not `any`).
  return c.json({ success: true, data }, status as never)
}

export function err(c: Context, code: string, message: string, status = 400) {
  return c.json({ error: { code, message } }, status as never)
}

export function apiOnError(e: Error, c: Context) {
  console.error('api_error', e.message)
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500)
}
