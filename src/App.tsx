import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthStatus, Gate } from './lib/session'
import { classifyGate, fetchAuthStatus } from './lib/session'

const AUTHPAK_LOGIN = 'https://authpak.foundry-ns.com/login'

function loginUrl(): string {
  const redirect = encodeURIComponent(window.location.href)
  return `${AUTHPAK_LOGIN}?redirect_uri=${redirect}`
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-10 text-center shadow-sm">
        <div className="mb-6 font-display text-2xl font-semibold tracking-tight text-ink">
          Foundry <span className="text-accent">Clarion</span>
        </div>
        {children}
      </div>
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

function AppShell({ status }: { status: AuthStatus }) {
  return (
    <Shell>
      <p className="mb-2 text-ink">You're in.</p>
      <p className="text-sm text-muted">
        <span className="font-mono">{status.email}</span> · role{' '}
        <span className="font-mono text-ink">{status.clarionRole}</span>
      </p>
      <p className="mt-6 text-xs text-muted">The agent console arrives in a later phase.</p>
    </Shell>
  )
}

export default function App() {
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
  return <AppShell status={status} />
}
