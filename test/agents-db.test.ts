import { describe, it, expect } from 'vitest'
import { insertAgent, getAgentByEmail, listAgents } from '../server/db/agents'
import { upsertSkill } from '../server/db/skills'

// Minimal fake D1 backed by a plain array of "rows" per table keyed off SQL fragments.
function memDb() {
  const agents: Record<string, unknown>[] = []
  const skills: Record<string, unknown>[] = []
  const bindThen = (sql: string, args: unknown[]) => ({
    async run() {
      if (sql.startsWith('INSERT INTO cc_agents')) agents.push({ id: args[0], organization_id: args[1], user_id: args[2], email: args[3], workspace_resource_id: args[4], twilio_worker_sid: args[5], status: 'offline', activity_sid: null })
      if (sql.startsWith('INSERT INTO cc_skills')) skills.push({ id: args[0], organization_id: args[1], name: args[2] })
      return {}
    },
    async first() {
      if (sql.includes('FROM cc_agents') && sql.includes('email')) return agents.find((a) => a.organization_id === args[0] && a.email === args[1]) ?? null
      if (sql.includes('FROM cc_skills')) return skills.find((s) => s.organization_id === args[0] && s.name === args[1]) ?? null
      return null
    },
    async all() {
      if (sql.includes('FROM cc_agents')) return { results: agents.filter((a) => a.organization_id === args[0]) }
      return { results: [] }
    },
  })
  return { prepare: (sql: string) => ({ bind: (...args: unknown[]) => bindThen(sql, args) }) } as unknown as D1Database
}

describe('cc_agents accessors', () => {
  it('inserts and reads an agent back by email', async () => {
    const db = memDb()
    await insertAgent(db, { id: 'a1', organizationId: 'o1', userId: 'u1', email: 'ada@x.com', workspaceResourceId: 'r1', twilioWorkerSid: 'WKdryrun_a1' })
    const got = await getAgentByEmail(db, 'o1', 'ada@x.com')
    expect(got?.id).toBe('a1')
    expect(got?.twilioWorkerSid).toBe('WKdryrun_a1')
    expect((await listAgents(db, 'o1')).length).toBe(1)
  })
  it('does not leak another org\'s agents', async () => {
    const db = memDb()
    await insertAgent(db, { id: 'a1', organizationId: 'o1', userId: null, email: 'ada@x.com', workspaceResourceId: null, twilioWorkerSid: null })
    expect(await getAgentByEmail(db, 'o2', 'ada@x.com')).toBeNull()
    expect((await listAgents(db, 'o2')).length).toBe(0)
  })
})

describe('cc_skills upsert', () => {
  it('inserts a new skill and returns an id', async () => {
    const db = memDb()
    const id = await upsertSkill(db, 'o1', 'Billing')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})
