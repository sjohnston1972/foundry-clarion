import { describe, it, expect } from 'vitest'
import { validateFlow } from '../server/lib/ivr/validate'
import type { IvrFlowDefinition } from '../server/lib/ivr/graph'

// A valid v1 flow exercising every node type and required branch:
// start -> play -> menu -[1]-> routeToQueue, -[2]-> voicemail, -[timeout]-> hangup, -[invalid]-> play
function validFlow(): IvrFlowDefinition {
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

const ctx = { queueIds: ['q_123'] }

describe('validateFlow', () => {
  it('accepts a valid flow', () => {
    const result = validateFlow(validFlow(), ctx)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rule 1: rejects a flow with no start node', () => {
    const flow = validFlow()
    flow.nodes = flow.nodes.filter((n) => n.type !== 'start')
    const result = validateFlow(flow, ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('exactly one start node'))).toBe(true)
  })

  it('rule 1: rejects a flow whose entryNodeId does not point to the start node', () => {
    const flow = validFlow()
    flow.entryNodeId = 'n_hi'
    const result = validateFlow(flow, ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('entryNodeId must point to the start node'))).toBe(true)
  })

  it('rule 2: rejects a menu missing its required "invalid" branch', () => {
    const flow = validFlow()
    flow.edges = flow.edges.filter((e) => e.branch !== 'invalid')
    const result = validateFlow(flow, ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('missing its required "invalid" branch'))).toBe(true)
  })

  it('rule 2: rejects a menu with no digit-key branch', () => {
    const flow = validFlow()
    flow.edges = flow.edges.filter((e) => e.branch !== '1' && e.branch !== '2')
    const result = validateFlow(flow, ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('at least one digit-key branch'))).toBe(true)
  })

  it('rule 3: rejects an orphan node unreachable from start', () => {
    const flow = validFlow()
    flow.nodes.push({ id: 'n_orphan', type: 'hangup', position: { x: 0, y: 0 }, config: {} })
    const result = validateFlow(flow, ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('n_orphan') && e.includes('not reachable'))).toBe(true)
  })

  it('rule 4: rejects a node with no path to a terminal node', () => {
    const flow = validFlow()
    // Redirect the menu's timeout branch into a two-node loop that never reaches a terminal.
    flow.nodes.push({ id: 'n_loop_a', type: 'play', position: { x: 0, y: 0 }, config: { say: 'loop a' } })
    flow.nodes.push({ id: 'n_loop_b', type: 'play', position: { x: 0, y: 0 }, config: { say: 'loop b' } })
    flow.edges = flow.edges.map((e) => (e.branch === 'timeout' ? { ...e, target: 'n_loop_a' } : e))
    flow.edges.push({ source: 'n_loop_a', target: 'n_loop_b', branch: 'next' })
    flow.edges.push({ source: 'n_loop_b', target: 'n_loop_a', branch: 'next' })
    const result = validateFlow(flow, ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('n_loop_a') && e.includes('no path to a terminal node'))).toBe(true)
    expect(result.errors.some((e) => e.includes('n_loop_b') && e.includes('no path to a terminal node'))).toBe(true)
  })

  it('rule 5: rejects a menu with duplicate digit-key branches', () => {
    const flow = validFlow()
    flow.edges = flow.edges.map((e) => (e.branch === '2' ? { ...e, branch: '1' } : e))
    const result = validateFlow(flow, ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('duplicate key branch "1"'))).toBe(true)
  })

  it('rule 5: rejects a collect node with an invalid variable identifier', () => {
    const flow = validFlow()
    flow.nodes.push({ id: 'n_acct', type: 'collect', position: { x: 0, y: 0 }, config: { prompt: 'Enter your account number.', numDigits: 6, variable: '123-bad' } })
    flow.edges.push({ source: 'n_hi', target: 'n_acct', branch: 'next2' }) // not wired as "next" from n_hi; only checking config validity here
    flow.edges.push({ source: 'n_acct', target: 'n_menu', branch: 'next' })
    const result = validateFlow(flow, ctx)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('invalid variable name "123-bad"'))).toBe(true)
  })

  it('rule 5: rejects a routeToQueue node referencing a queue that does not exist in the org', () => {
    const flow = validFlow()
    const result = validateFlow(flow, { queueIds: ['q_other'] })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('references unknown queue "q_123"'))).toBe(true)
  })
})
