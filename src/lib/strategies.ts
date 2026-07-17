// Mirror of server/lib/queues/strategies.ts — server stays the source of truth for validation.
export const QUEUE_STRATEGIES = ['longest-idle', 'round-robin', 'ring-all', 'priority'] as const
export type QueueStrategy = typeof QUEUE_STRATEGIES[number]
export const DEFAULT_QUEUE_STRATEGY: QueueStrategy = 'longest-idle'
export const QUEUE_STRATEGY_LABELS: Record<QueueStrategy, string> = {
  'longest-idle': 'Longest idle',
  'round-robin': 'Round robin',
  'ring-all': 'Ring all',
  priority: 'Priority order',
}
