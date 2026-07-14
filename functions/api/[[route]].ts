import { handle } from 'hono/cloudflare-pages'
import { createApp } from '../../server/app'

export const onRequest = handle(createApp())

// Durable Object classes referenced in wrangler.jsonc must be exported from the Functions bundle.
export { ClarionRealtime } from '../../server/realtime/clarion-realtime'
