import { describe, it, expect } from 'vitest'
import { insertCall, getCallBySid, listCallsForOrg, updateCallOutcome } from '../server/db/calls'

// Minimal fake D1 backed by a plain array, mirroring test/agents-db.test.ts's memDb pattern.
function memDb() {
  const calls: Record<string, unknown>[] = []
  const bindThen = (sql: string, args: unknown[]) => ({
    async run() {
      if (sql.startsWith('INSERT INTO cc_calls')) {
        calls.push({
          id: args[0], organization_id: args[1], twilio_call_sid: args[2],
          from_e164: args[3], to_e164: args[4], queue_id: args[5],
          agent_id: null, disposition: null, duration_s: null,
        })
      }
      if (sql.startsWith('UPDATE cc_calls')) {
        const row = calls.find((c) => c.organization_id === args[3] && c.twilio_call_sid === args[4])
        if (row) { row.disposition = args[0]; row.duration_s = args[1]; row.agent_id = args[2] }
      }
      return {}
    },
    async first() {
      if (sql.includes('FROM cc_calls')) return calls.find((c) => c.organization_id === args[0] && c.twilio_call_sid === args[1]) ?? null
      return null
    },
    async all() {
      if (sql.includes('FROM cc_calls')) return { results: calls.filter((c) => c.organization_id === args[0]) }
      return { results: [] }
    },
  })
  return { prepare: (sql: string) => ({ bind: (...args: unknown[]) => bindThen(sql, args) }) } as unknown as D1Database
}

describe('cc_calls accessors', () => {
  it('inserts and reads a call back by Twilio SID', async () => {
    const db = memDb()
    await insertCall(db, { id: 'c1', organizationId: 'o1', twilioCallSid: 'CAdryrun_c1', fromE164: '+15551234567', toE164: '+15557654321', queueId: 'q1' })
    const got = await getCallBySid(db, 'o1', 'CAdryrun_c1')
    expect(got?.id).toBe('c1')
    expect(got?.queueId).toBe('q1')
    expect((await listCallsForOrg(db, 'o1')).length).toBe(1)
  })

  it('does not leak another org\'s calls (cross-tenant)', async () => {
    const db = memDb()
    await insertCall(db, { id: 'c1', organizationId: 'o1', twilioCallSid: 'CAdryrun_c1', fromE164: '+15551234567', toE164: '+15557654321', queueId: null })
    expect(await getCallBySid(db, 'o2', 'CAdryrun_c1')).toBeNull()
    expect((await listCallsForOrg(db, 'o2')).length).toBe(0)
  })

  it('updates disposition, duration, and the connected agent', async () => {
    const db = memDb()
    await insertCall(db, { id: 'c1', organizationId: 'o1', twilioCallSid: 'CAdryrun_c1', fromE164: '+15551234567', toE164: '+15557654321', queueId: 'q1' })
    await updateCallOutcome(db, 'o1', 'CAdryrun_c1', { disposition: 'completed', durationS: 42, agentId: 'a1' })
    const got = await getCallBySid(db, 'o1', 'CAdryrun_c1')
    expect(got).toMatchObject({ disposition: 'completed', durationS: 42, agentId: 'a1' })
  })
})
