import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('0002_agents migration', () => {
  const sql = readFileSync('migrations/0002_agents.sql', 'utf8')
  it('declares the three Phase-2 tables', () => {
    for (const t of ['cc_agents', 'cc_skills', 'cc_agent_skills']) {
      expect(sql).toContain(`CREATE TABLE ${t}`)
    }
  })
  it('scopes agents + skills by org and links agent_skills to agents', () => {
    expect(sql).toContain('UNIQUE (organization_id, email)')
    expect(sql).toContain('UNIQUE (organization_id, name)')
    expect(sql).toContain('REFERENCES cc_agents(id)')
  })
})
