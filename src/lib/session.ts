export type AuthStatus = {
  authenticated: boolean
  hasOrg?: boolean
  email?: string | null
  orgSlug?: string | null
  orgRole?: string | null
  clarionRole?: 'admin' | 'supervisor' | 'agent' | null
  disabled?: boolean
}

export type Gate = 'signed-out' | 'no-access' | 'app'

export function classifyGate(s: AuthStatus): Gate {
  if (!s.authenticated) return 'signed-out'
  if (!s.clarionRole) return 'no-access'
  return 'app'
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth-status', { credentials: 'include' })
  const body = await res.json()
  return body.data as AuthStatus
}
