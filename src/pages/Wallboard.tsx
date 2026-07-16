import { useEffect, useState } from 'react'
import { Card, CardHead, Stat, Badge, EmptyState } from '../components/ui'
import { openPresenceSocket } from '../lib/twilio-voice'
import type { PresenceAgent } from '../lib/twilio-voice'

/**
 * Wallboard SCAFFOLD — exactly what Steven approved for this run: live agent
 * presence from the org's realtime hub, nothing else. No monitor/whisper/barge
 * (Phase 5), no call metrics (no live call events exist yet — see the
 * EmptyState panel where they'll go).
 */
export default function Wallboard() {
  const [presence, setPresence] = useState<PresenceAgent[]>([])

  useEffect(() => {
    const ws = openPresenceSocket(setPresence)
    return () => ws.close()
  }, [])

  const count = (status: string) => presence.filter((a) => a.status === status).length

  return (
    <div className="space-y-6">
      <section aria-label="Agent stats">
        <Card>
          <CardHead title="Wallboard" hint="Live agent presence for this org" />
          <div className="grid grid-cols-2 gap-6 px-5 pb-5 sm:grid-cols-4">
            <Stat label="Online" value={presence.length} accent />
            <Stat label="Available" value={count('available')} />
            <Stat label="On call" value={count('on-call')} />
            <Stat label="Wrap-up" value={count('wrap-up')} />
          </div>
        </Card>
      </section>

      <section aria-label="Agents">
        <Card>
          <CardHead title="Agents" hint="Tiles update live from the realtime hub" />
          {presence.length === 0 ? (
            <EmptyState title="No agents online" hint="Tiles appear the moment an agent sets a status." />
          ) : (
            <ul aria-label="Presence tiles" className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-3">
              {presence.map((a) => (
                <li key={a.identity} className="rounded-[var(--radius-card)] border border-line bg-raised p-4">
                  <div className="text-sm font-medium text-ink">{a.identity}</div>
                  <div className="mt-1">
                    <Badge tone={a.status === 'available' ? 'accent' : 'neutral'}>{a.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-label="Call volume">
        <Card>
          <CardHead title="Call volume" hint="Queue metrics and wait times" />
          <EmptyState
            title="No live call metrics yet"
            hint="Live call events land in a later phase; this panel will chart queue volume and wait times when they do."
          />
        </Card>
      </section>
    </div>
  )
}
