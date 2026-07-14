import type { FoundryAuthVariables } from '@foundry/auth'

export type Bindings = {
  DB: D1Database
  /** When 'true', a valid AuthPak session is REQUIRED (set at cutover). */
  AUTH_ENFORCE?: string
  /** Comma-separated emails granted a cross-tenant Clarion site-admin view. */
  ADMIN_EMAILS?: string
  APP_BASE_URL?: string
}

/** AuthPak identity is present only on authenticated requests. `organizationId`
 *  is resolved by the auth middleware; `clarionRole` is Clarion's own role. */
export type Variables = Partial<FoundryAuthVariables> & {
  organizationId: string | null
  clarionRole: 'admin' | 'supervisor' | 'agent' | null
}

export type Env = { Bindings: Bindings; Variables: Variables }
