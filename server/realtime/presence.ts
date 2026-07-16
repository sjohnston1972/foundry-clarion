export type PresenceEvent = { identity: string; status: string; at: number }
export type PresenceState = Record<string, { status: string; at: number }>

/** Pure reducer. 'offline' removes the agent; anything else upserts it. */
export function applyPresence(state: PresenceState, e: PresenceEvent): PresenceState {
  const next: PresenceState = { ...state }
  if (e.status === 'offline') { delete next[e.identity]; return next }
  next[e.identity] = { status: e.status, at: e.at }
  return next
}

export function snapshotMessage(state: PresenceState): string {
  const agents = Object.entries(state).map(([identity, v]) => ({ identity, status: v.status, at: v.at }))
  return JSON.stringify({ type: 'presence', agents })
}
