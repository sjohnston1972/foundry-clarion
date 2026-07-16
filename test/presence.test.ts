import { describe, it, expect } from 'vitest'
import { applyPresence, snapshotMessage } from '../server/realtime/presence'

describe('applyPresence', () => {
  it('adds and updates an agent', () => {
    let s = applyPresence({}, { identity: 'ada@x.com', status: 'available', at: 1 })
    expect(s['ada@x.com'].status).toBe('available')
    s = applyPresence(s, { identity: 'ada@x.com', status: 'on-call', at: 2 })
    expect(s['ada@x.com'].status).toBe('on-call')
  })
  it('removes an agent on offline', () => {
    const s = applyPresence({ 'ada@x.com': { status: 'available', at: 1 } }, { identity: 'ada@x.com', status: 'offline', at: 2 })
    expect(s['ada@x.com']).toBeUndefined()
  })
  it('serialises a snapshot message', () => {
    const msg = JSON.parse(snapshotMessage({ 'ada@x.com': { status: 'available', at: 1 } }))
    expect(msg.type).toBe('presence')
    expect(msg.agents).toEqual([{ identity: 'ada@x.com', status: 'available', at: 1 }])
  })
  // Step 4 fallback coverage (no workers project on this machine): the DO's
  // webSocketClose applies exactly this event for the socket's attached identity.
  it('disconnect cleanup: offline for one identity leaves the survivor untouched', () => {
    let s = applyPresence({}, { identity: 'ada@x.com', status: 'available', at: 1 })
    s = applyPresence(s, { identity: 'bob@x.com', status: 'on-call', at: 2 })
    s = applyPresence(s, { identity: 'ada@x.com', status: 'offline', at: 3 })
    expect(s['ada@x.com']).toBeUndefined()
    expect(s['bob@x.com']).toEqual({ status: 'on-call', at: 2 })
    const msg = JSON.parse(snapshotMessage(s))
    expect(msg.agents).toEqual([{ identity: 'bob@x.com', status: 'on-call', at: 2 }])
  })
})
