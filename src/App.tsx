import { useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { fetchVoiceToken, registerDevice, openPresenceSocket } from './lib/twilio-voice'
import type { PresenceAgent } from './lib/twilio-voice'
import { AuthGate } from './components/AuthGate'
import { AppShell } from './components/AppShell'
import { EmptyState } from './components/ui'
import Agents from './pages/Agents'

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

function ComingSoon({ title }: { title: string }) {
  return <EmptyState title={title} hint="This page lands in a later step of the current run." />
}

export default function App() {
  return (
    <Routes>
      <Route element={<AuthGate />}>
        <Route element={<AppShell />}>
          {/* Softphone stays inline as SoftphonePanel until Step 13 replaces it with
              src/pages/Softphone.tsx (see PLAN.md Step 13). */}
          <Route index element={<SoftphonePanel />} />
          <Route path="agents" element={<Agents />} />
          <Route path="queues" element={<ComingSoon title="Queues" />} />
          <Route path="wallboard" element={<ComingSoon title="Wallboard" />} />
        </Route>
      </Route>
    </Routes>
  )
}
