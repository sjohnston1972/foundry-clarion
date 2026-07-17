import { describe, it, expect } from 'vitest'
import { interpret, MAX_STEPS, type InterpretInput, type Vars } from '../server/lib/ivr/interpret'
import type { IvrFlowDefinition } from '../server/lib/ivr/graph'

function baseInput(overrides: Partial<InterpretInput> = {}): InterpretInput {
  return {
    digits: undefined,
    now: new Date(Date.UTC(2026, 6, 20, 10, 0, 0)),
    buildGatherActionUrl: (nodeId: string, vars: Vars) => `https://clarion.test/api/voice/ivr?node=${nodeId}&vars=${encodeURIComponent(JSON.stringify(vars))}`,
    voicemailActionUrl: 'https://clarion.test/api/voice/ivr-vm-action',
    voicemailStatusCallbackUrl: 'https://clarion.test/api/voice/voicemail',
    queueWorkflowSids: { q_123: 'WWtest123' },
    enqueueTaskXml: '<Task>{}</Task>',
    recordingConsentSay: '',
    ...overrides,
  }
}

// start -> play -> menu -[1]-> routeToQueue, -[2]-> voicemail, -[timeout]-> hangup, -[invalid]-> play
function menuFlow(): IvrFlowDefinition {
  return {
    entryNodeId: 'n_start',
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 0, y: 0 }, config: {} },
      { id: 'n_hi', type: 'play', position: { x: 0, y: 0 }, config: { say: 'Thanks for calling Acme.' } },
      { id: 'n_menu', type: 'menu', position: { x: 0, y: 0 }, config: { prompt: 'Press 1 for Sales, 2 for Support.', timeoutSeconds: 5 } },
      { id: 'n_sales', type: 'routeToQueue', position: { x: 0, y: 0 }, config: { queueId: 'q_123' } },
      { id: 'n_vm', type: 'voicemail', position: { x: 0, y: 0 }, config: { prompt: 'Leave a message.', maxLengthSeconds: 120 } },
      { id: 'n_bye', type: 'hangup', position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [
      { source: 'n_start', target: 'n_hi', branch: 'next' },
      { source: 'n_hi', target: 'n_menu', branch: 'next' },
      { source: 'n_menu', target: 'n_sales', branch: '1' },
      { source: 'n_menu', target: 'n_vm', branch: '2' },
      { source: 'n_menu', target: 'n_bye', branch: 'timeout' },
      { source: 'n_menu', target: 'n_hi', branch: 'invalid' },
    ],
  }
}

describe('interpret — start, play, menu (entry walk stops at a fresh menu)', () => {
  it('chains start -> play -> menu, emitting Say + Gather, and stops (not terminal)', () => {
    const result = interpret(menuFlow(), 'n_start', {}, baseInput())
    expect(result.terminal).toBe(false)
    expect(result.nodeId).toBe('n_menu')
    expect(result.twiml).toContain('<Say>Thanks for calling Acme.</Say>')
    expect(result.twiml).toContain('<Gather numDigits="1" timeout="5"')
    expect(result.twiml).toContain('Press 1 for Sales, 2 for Support.')
  })
})

describe('interpret — menu digit -> branch, timeout, invalid', () => {
  it('resumes a menu with a mapped digit and follows that branch to routeToQueue (terminal)', () => {
    const result = interpret(menuFlow(), 'n_menu', {}, baseInput({ digits: '1' }))
    expect(result.terminal).toBe(true)
    expect(result.nodeId).toBe('n_sales')
    expect(result.twiml).toContain('<Enqueue workflowSid="WWtest123">')
  })

  it('resumes a menu with no digits (Gather timeout) and follows the "timeout" branch', () => {
    const result = interpret(menuFlow(), 'n_menu', {}, baseInput({ digits: undefined }))
    expect(result.terminal).toBe(true)
    expect(result.nodeId).toBe('n_bye')
    expect(result.twiml).toContain('<Hangup/>')
  })

  it('resumes a menu with an unmapped digit and follows the "invalid" branch, re-prompting fresh', () => {
    const result = interpret(menuFlow(), 'n_menu', {}, baseInput({ digits: '9' }))
    // invalid -> n_hi (play) -> n_menu again, a *fresh* encounter this walk -> emits a new Gather, stops.
    expect(result.terminal).toBe(false)
    expect(result.nodeId).toBe('n_menu')
    expect(result.twiml).toContain('Thanks for calling Acme.')
    expect(result.twiml).toContain('<Gather')
  })
})

describe('interpret — voicemail node', () => {
  it('emits Say + Record and terminates', () => {
    const result = interpret(menuFlow(), 'n_menu', {}, baseInput({ digits: '2' }))
    expect(result.terminal).toBe(true)
    expect(result.nodeId).toBe('n_vm')
    expect(result.twiml).toContain('<Say>Leave a message.</Say>')
    expect(result.twiml).toContain('maxLength="120"')
    expect(result.twiml).toContain('action="https://clarion.test/api/voice/ivr-vm-action"')
    expect(result.twiml).toContain('recordingStatusCallback="https://clarion.test/api/voice/voicemail"')
  })
})

// start -> collect(acct, 6 digits) -[next]-> if($acct eq "000000") -[true]-> hangup(bad), -[false]-> hangup(ok)
function collectIfFlow(): IvrFlowDefinition {
  return {
    entryNodeId: 'n_start',
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 0, y: 0 }, config: {} },
      { id: 'n_acct', type: 'collect', position: { x: 0, y: 0 }, config: { prompt: 'Enter your account number.', numDigits: 6, variable: 'acct' } },
      { id: 'n_if', type: 'if', position: { x: 0, y: 0 }, config: { left: '$acct', op: 'eq', right: '000000' } },
      { id: 'n_bad', type: 'hangup', position: { x: 0, y: 0 }, config: {} },
      { id: 'n_ok', type: 'hangup', position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [
      { source: 'n_start', target: 'n_acct', branch: 'next' },
      { source: 'n_acct', target: 'n_if', branch: 'next' },
      { source: 'n_if', target: 'n_bad', branch: 'true' },
      { source: 'n_if', target: 'n_ok', branch: 'false' },
    ],
  }
}

describe('interpret — collect stores a var, if branches on it, vars round-trip', () => {
  it('entry walk stops at the fresh collect node, emitting its Gather', () => {
    const result = interpret(collectIfFlow(), 'n_start', {}, baseInput())
    expect(result.terminal).toBe(false)
    expect(result.nodeId).toBe('n_acct')
    expect(result.twiml).toContain('<Gather numDigits="6"')
    expect(result.vars).toEqual({})
  })

  it('resuming collect stores Digits into the configured variable and follows "next"', () => {
    const result = interpret(collectIfFlow(), 'n_acct', {}, baseInput({ digits: '000000' }))
    expect(result.terminal).toBe(true)
    expect(result.nodeId).toBe('n_bad')
    expect(result.vars).toEqual({ acct: '000000' })
  })

  it('vars round-trip across two interpret() calls (as they would via the action URL)', () => {
    const first = interpret(collectIfFlow(), 'n_start', {}, baseInput())
    expect(first.nodeId).toBe('n_acct')
    // Simulate the webhook carrying `first.vars` back in via the action URL on the next request.
    const second = interpret(collectIfFlow(), first.nodeId, first.vars, baseInput({ digits: '654321' }))
    expect(second.terminal).toBe(true)
    expect(second.nodeId).toBe('n_ok')
    expect(second.vars).toEqual({ acct: '654321' })
  })
})

// A single businessHours node, open Mon 09:00-17:00 UTC (matching the fixed "now" in baseInput).
function hoursFlow(): IvrFlowDefinition {
  return {
    entryNodeId: 'n_start',
    nodes: [
      { id: 'n_start', type: 'start', position: { x: 0, y: 0 }, config: {} },
      {
        id: 'n_hours',
        type: 'businessHours',
        position: { x: 0, y: 0 },
        config: { timezone: 'UTC', weekly: [{ day: new Date(Date.UTC(2026, 6, 20)).getUTCDay(), open: '09:00', close: '17:00' }] },
      },
      { id: 'n_open', type: 'hangup', position: { x: 0, y: 0 }, config: {} },
      { id: 'n_closed', type: 'hangup', position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [
      { source: 'n_start', target: 'n_hours', branch: 'next' },
      { source: 'n_hours', target: 'n_open', branch: 'open' },
      { source: 'n_hours', target: 'n_closed', branch: 'closed' },
    ],
  }
}

describe('interpret — businessHours branches on an injected "now"', () => {
  it('follows "open" at 10:00 UTC (inside the 09:00-17:00 window)', () => {
    const result = interpret(hoursFlow(), 'n_start', {}, baseInput({ now: new Date(Date.UTC(2026, 6, 20, 10, 0, 0)) }))
    expect(result.nodeId).toBe('n_open')
  })

  it('follows "closed" at 20:00 UTC (outside the window)', () => {
    const result = interpret(hoursFlow(), 'n_start', {}, baseInput({ now: new Date(Date.UTC(2026, 6, 20, 20, 0, 0)) }))
    expect(result.nodeId).toBe('n_closed')
  })
})

describe('interpret — max-steps guard', () => {
  it('emits Hangup and stops instead of looping forever on a linear cycle', () => {
    const flow: IvrFlowDefinition = {
      entryNodeId: 'n_a',
      nodes: [
        { id: 'n_a', type: 'play', position: { x: 0, y: 0 }, config: { say: 'a' } },
        { id: 'n_b', type: 'play', position: { x: 0, y: 0 }, config: { say: 'b' } },
      ],
      edges: [
        { source: 'n_a', target: 'n_b', branch: 'next' },
        { source: 'n_b', target: 'n_a', branch: 'next' },
      ],
    }
    const result = interpret(flow, 'n_a', {}, baseInput())
    expect(result.terminal).toBe(true)
    expect(result.twiml).toContain('<Hangup/>')
    // Bounded work: at most MAX_STEPS Say fragments, one per loop iteration.
    const sayCount = (result.twiml.match(/<Say>/g) ?? []).length
    expect(sayCount).toBeLessThanOrEqual(MAX_STEPS)
  })
})
