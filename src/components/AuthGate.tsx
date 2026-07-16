import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import type { AuthStatus, Gate } from '../lib/session'
import { classifyGate, fetchAuthStatus } from '../lib/session'
import { Card } from './ui'

const AUTHPAK_LOGIN = 'https://authpak.foundry-ns.com/login'

function loginUrl(): string {
  const redirect = encodeURIComponent(window.location.href)
  return `${AUTHPAK_LOGIN}?redirect_uri=${redirect}`
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <Card className="w-full max-w-md p-10 text-center">
        <div className="mb-6 font-display text-2xl font-semibold tracking-tight text-ink">
          Foundry <span className="text-[var(--color-accent)]">Clarion</span>
        </div>
        {children}
      </Card>
    </div>
  )
}

function SignedOut() {
  return (
    <Shell>
      <p className="mb-8 text-muted">Sign in with your Foundry account to continue.</p>
      <a
        href={loginUrl()}
        className="inline-block rounded-lg bg-accent px-5 py-2.5 font-medium text-white transition hover:opacity-90"
      >
        Sign in
      </a>
    </Shell>
  )
}

function NoAccess({ status }: { status: AuthStatus }) {
  return (
    <Shell>
      <p className="mb-2 text-ink">You don't have access to Clarion yet.</p>
      <p className="text-sm text-muted">
        Signed in as <span className="font-mono">{status.email ?? 'unknown'}</span>. Ask a Clarion
        admin in your organization to enable your account.
      </p>
    </Shell>
  )
}

/**
 * Layout route: fetches the session once, then either renders one of the
 * gate screens (signed-out / no-access) or, once authorized, an <Outlet/>
 * carrying `status` as router context for the routes nested under it
 * (see AppShell's useOutletContext).
 */
export function AuthGate() {
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchAuthStatus()
      .then(setStatus)
      .catch(() => setError(true))
  }, [])

  if (error) {
    return (
      <Shell>
        <p className="text-muted">Couldn't reach Clarion. Try reloading.</p>
      </Shell>
    )
  }

  if (!status) {
    return (
      <Shell>
        <p className="text-muted">Loading…</p>
      </Shell>
    )
  }

  const gate: Gate = classifyGate(status)
  if (gate === 'signed-out') return <SignedOut />
  if (gate === 'no-access') return <NoAccess status={status} />

  return <Outlet context={status} />
}
