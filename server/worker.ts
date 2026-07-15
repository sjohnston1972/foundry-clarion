import { createApp } from './app'

export default createApp()

// Durable Object classes referenced in wrangler.jsonc must be exported from the entrypoint.
export { ClarionRealtime } from './realtime/clarion-realtime'
