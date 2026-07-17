import { describe, it, expect } from 'vitest'
import {
  QUEUE_STRATEGIES, isQueueStrategy, QUEUE_STRATEGY_LABELS, DEFAULT_QUEUE_STRATEGY,
} from '../server/lib/queues/strategies'

describe('queue strategies', () => {
  it('exposes exactly the four agreed strategies', () => {
    expect([...QUEUE_STRATEGIES]).toEqual(['longest-idle', 'round-robin', 'ring-all', 'priority'])
  })
  it('accepts valid values and rejects everything else', () => {
    expect(isQueueStrategy('round-robin')).toBe(true)
    expect(isQueueStrategy('ring-all')).toBe(true)
    expect(isQueueStrategy('nonsense')).toBe(false)
    expect(isQueueStrategy(null)).toBe(false)
    expect(isQueueStrategy(3)).toBe(false)
  })
  it('has a human label for every strategy and a sane default', () => {
    for (const s of QUEUE_STRATEGIES) expect(QUEUE_STRATEGY_LABELS[s].length).toBeGreaterThan(0)
    expect(DEFAULT_QUEUE_STRATEGY).toBe('longest-idle')
  })
})
