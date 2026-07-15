import { useEffect, useState } from 'react'
import { Card, CardHead, Button, Badge, EmptyState } from '../components/ui'
import { fetchVoiceToken, registerDevice, openPresenceSocket } from '../lib/twilio-voice'
import type { PresenceAgent } from '../lib/twilio-voice'

type RegisterState = 'idle' | 'registering' | 'registered' | 'unavailable' | 'error'
type AgentStatusValue = 'offline' | 'available' | 'on-call' | 'wrap-up'

const REGISTER_LABEL: Record<Exclude<RegisterState, 'unavailable'>, string> = {
  idle: 'Register softphone',
  registering: 'Registering…',
  registered: 'Registered',
  error: 'Registration failed — retry',
}

export default function Softphone() {
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
    <div className="grid max-w-3xl gap-6">
      <section aria-label="Softphone">
        <Card>
          <CardHead
            title="Softphone"
            hint="Register this browser as your voice device, then set your status"
            right={registerState === 'registered' ? <Badge tone="accent">registered</Badge> : undefined}
          />
          <div className="space-y-4 px-5 pb-5">
            {registerState === 'unavailable' ? (
              <EmptyState
                title="Telephony not yet configured"
                hint="Voice tokens aren't available on this server yet (Twilio API keys pending). Presence still works below."
              />
            ) : (
              <Button
                variant={registerState === 'error' ? 'danger' : 'primary'}
                className="w-full"
                disabled={registerState === 'registering' || registerState === 'registered'}
                onClick={handleRegister}
              >
                {REGISTER_LABEL[registerState]}
              </Button>
            )}

            <div>
              <label className="block text-xs text-muted" htmlFor="agent-status">
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
            </div>
          </div>
        </Card>
      </section>

      <section aria-label="Presence">
        <Card>
          <CardHead title="Presence" hint="Live agent roster from this org's realtime hub" />
          {presence.length === 0 ? (
            <EmptyState title="No agents online" hint="Agents appear here the moment they set a status." />
          ) : (
            <ul aria-label="Agent roster" className="space-y-1 px-5 pb-4">
              {presence.map((a) => (
                <li key={a.identity} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                  <span className="text-sm font-medium text-ink">{a.identity}</span>
                  <Badge tone={a.status === 'available' ? 'accent' : 'neutral'}>{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}
