import { describe, it, expect } from 'vitest'
import { insertQueue, getQueueById, listQueues, deleteQueue, addQueueMember, listQueueMembers, removeQueueMember } from '../server/db/queues'

// Minimal fake D1 backed by plain arrays, mirroring test/agents-db.test.ts's memDb pattern.
function memDb() {
  const queues: Record<string, unknown>[] = []
  const members: Record<string, unknown>[] = []
  const bindThen = (sql: string, args: unknown[]) => ({
    async run() {
      if (sql.startsWith('INSERT INTO cc_queues')) {
        queues.push({ id: args[0], organization_id: args[1], name: args[2], twilio_workflow_sid: args[3], strategy: args[4] })
      }
      if (sql.startsWith('DELETE FROM cc_queues')) {
        const i = queues.findIndex((q) => q.organization_id === args[0] && q.id === args[1])
        if (i >= 0) queues.splice(i, 1)
      }
      if (sql.startsWith('INSERT INTO cc_queue_members')) {
        const i = members.findIndex((m) => m.queue_id === args[0] && m.agent_id === args[1])
        if (i >= 0) members[i] = { queue_id: args[0], agent_id: args[1], priority: args[2] }
        else members.push({ queue_id: args[0], agent_id: args[1], priority: args[2] })
      }
      if (sql.startsWith('DELETE FROM cc_queue_members')) {
        const i = members.findIndex((m) => m.queue_id === args[0] && m.agent_id === args[1])
        if (i >= 0) members.splice(i, 1)
      }
      return {}
    },
    async first() {
      if (sql.includes('FROM cc_queues')) return queues.find((q) => q.organization_id === args[0] && q.id === args[1]) ?? null
      return null
    },
    async all() {
      if (sql.includes('FROM cc_queues')) return { results: queues.filter((q) => q.organization_id === args[0]) }
      if (sql.includes('FROM cc_queue_members')) return { results: members.filter((m) => m.queue_id === args[0]) }
      return { results: [] }
    },
  })
  return { prepare: (sql: string) => ({ bind: (...args: unknown[]) => bindThen(sql, args) }) } as unknown as D1Database
}

describe('cc_queues accessors', () => {
  it('inserts and reads a queue back by id', async () => {
    const db = memDb()
    await insertQueue(db, { id: 'q1', organizationId: 'o1', name: 'Support', twilioWorkflowSid: 'WWdryrun_q1', strategy: 'longest-idle' })
    const got = await getQueueById(db, 'o1', 'q1')
    expect(got?.name).toBe('Support')
    expect(got?.twilioWorkflowSid).toBe('WWdryrun_q1')
    expect((await listQueues(db, 'o1')).length).toBe(1)
  })

  it('does not leak another org\'s queues (cross-tenant)', async () => {
    const db = memDb()
    await insertQueue(db, { id: 'q1', organizationId: 'o1', name: 'Support', twilioWorkflowSid: null, strategy: 'longest-idle' })
    expect(await getQueueById(db, 'o2', 'q1')).toBeNull()
    expect((await listQueues(db, 'o2')).length).toBe(0)
    // o1 is unaffected by the o2 read attempt.
    expect((await listQueues(db, 'o1')).length).toBe(1)
  })

  it('deletes a queue scoped to its org', async () => {
    const db = memDb()
    await insertQueue(db, { id: 'q1', organizationId: 'o1', name: 'Support', twilioWorkflowSid: null, strategy: 'longest-idle' })
    await deleteQueue(db, 'o1', 'q1')
    expect(await getQueueById(db, 'o1', 'q1')).toBeNull()
  })

  it('adds, lists, and removes queue members', async () => {
    const db = memDb()
    await insertQueue(db, { id: 'q1', organizationId: 'o1', name: 'Support', twilioWorkflowSid: null, strategy: 'longest-idle' })
    await addQueueMember(db, 'q1', 'a1', 5)
    await addQueueMember(db, 'q1', 'a2', 1)
    expect((await listQueueMembers(db, 'q1')).length).toBe(2)
    await removeQueueMember(db, 'q1', 'a1')
    const remaining = await listQueueMembers(db, 'q1')
    expect(remaining.length).toBe(1)
    expect(remaining[0].agentId).toBe('a2')
  })
})
