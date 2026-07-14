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
})
