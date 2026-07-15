import type { FoundryAuthVariables } from '@foundry/auth'

export type Bindings = {
  DB: D1Database
  /** Workspace's D1 (skills-foundry-db), bound READ-ONLY. */
  WORKSPACE_DB: D1Database
  /** Per-org realtime hub. */
  REALTIME: DurableObjectNamespace
  /** When 'true', a valid AuthPak session is REQUIRED (set at cutover). */
  AUTH_ENFORCE?: string
  /** Dev-only ('true' exactly): local-keypair session verify + /api/dev/session.
   *  NEVER set in wrangler.jsonc, CI, or any deployed environment. */
  DEV_AUTH?: string
  /** When 'true' (default), Twilio account-mutating calls are stubbed with fake SIDs. */
  TWILIO_DRY_RUN?: string
  ADMIN_EMAILS?: string
  APP_BASE_URL?: string
  // --- Twilio (values provided later; token signing is local, no network) ---
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_API_KEY_SID?: string
  TWILIO_API_KEY_SECRET?: string
  TWILIO_TASKROUTER_WORKSPACE_SID?: string
  TWILIO_TWIML_APP_SID?: string
}

export type Variables = Partial<FoundryAuthVariables> & {
  organizationId: string | null
  clarionRole: 'admin' | 'supervisor' | 'agent' | null
}

export type Env = { Bindings: Bindings; Variables: Variables }
