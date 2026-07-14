import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { AuthStatus, Gate } from './lib/session'
import { classifyGate, fetchAuthStatus } from './lib/session'
import { fetchVoiceToken, registerDevice, openPresenceSocket } from './lib/twilio-voice'
import type { PresenceAgent } from './lib/twilio-voice'

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

type RegisterState = 'idle' | 'registering' | 'registered' | 'unavailable' | 'error'
type AgentStatusValue = 'offline' | 'available' | 'on-call' | 'wrap-up'

const REGISTER_LABEL: Record<RegisterState, string> = {
  idle: 'Register',
  registering: 'Registering…',
  registered: 'Registered',
  unavailable: 'Telephony not yet configured',
  error: 'Registration failed — retry',
}

function SoftphonePanel() {
  const [registerState, setRegisterState] = useState<RegisterState>('idle')
  const [agentStatus, setAgentStatus] = useState<AgentStatusValue>('offline')
  const [presence, setPresence] = useState<PresenceAgent[]>([])

  useEffect(() => {
    const ws = openPresenceSocket(setPresence)
    return () => ws.close()
  }, [])

  async function handleRegister() {
    setRegisterState('registering')
    try {
      const { token } = await fetchVoiceToken()
      await registerDevice(token)
      setRegisterState('registered')
    } catch (e) {
      const unconfigured = e instanceof Error && e.message === 'token 503'
      setRegisterState(unconfigured ? 'unavailable' : 'error')
    }
  }

  async function handleStatusChange(next: AgentStatusValue) {
    setAgentStatus(next)
    try {
      await fetch('/api/agents/status', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      })
    } catch {
      /* best-effort; presence socket reconciles the real state */
    }
  }

  return (
    <div className="mt-8 rounded-xl border border-line bg-canvas p-5 text-left">
      <div className="mb-3 font-display text-sm font-semibold text-ink">Softphone</div>

      <button
        type="button"
        onClick={handleRegister}
        disabled={registerState === 'registering' || registerState === 'registered'}
        className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
      >
        {REGISTER_LABEL[registerState]}
      </button>

      <label className="mt-4 block text-xs text-muted" htmlFor="agent-status">
        Status
      </label>
      <select
        id="agent-status"
        value={agentStatus}
        onChange={(e) => handleStatusChange(e.target.value as AgentStatusValue)}
        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
      >
        <option value="offline">Offline</option>
        <option value="available">Available</option>
        <option value="on-call">On call</option>
        <option value="wrap-up">Wrap-up</option>
      </select>

      <div className="mt-4 text-xs text-muted">Presence</div>
      <ul className="mt-1 space-y-1 font-mono text-xs text-ink">
        {presence.length === 0 && <li className="text-muted">No agents online</li>}
        {presence.map((a) => (
          <li key={a.identity}>
            {a.identity} · <span className="text-accent">{a.status}</span>
          </li>
        ))}
      </ul>
    </div>
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
      <SoftphonePanel />
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
