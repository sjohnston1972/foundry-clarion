import { describe, it, expect } from 'vitest'
import { createApp } from '../server/app'

const DB = { prepare: () => ({ first: async () => ({ ok: 1 }) }) } as unknown as D1Database
const env = { DB }

describe('GET /api/health', () => {
  it('reports healthy when the DB responds', async () => {
    const app = createApp()
    const res = await app.request('/api/health', {}, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, status: 'healthy', database: 'connected' })
  })
})
