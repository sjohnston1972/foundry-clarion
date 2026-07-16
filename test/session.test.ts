import { describe, it, expect } from 'vitest'
import { classifyGate } from '../src/lib/session'

describe('classifyGate', () => {
  it('signed-out -> "signed-out"', () => {
    expect(classifyGate({ authenticated: false } as never)).toBe('signed-out')
  })
  it('authed but no clarion role -> "no-access"', () => {
    expect(classifyGate({ authenticated: true, hasOrg: true, clarionRole: null } as never)).toBe('no-access')
  })
  it('authed agent -> "app"', () => {
    expect(classifyGate({ authenticated: true, hasOrg: true, clarionRole: 'agent' } as never)).toBe('app')
  })
})
