import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('0003_queues_calls migration', () => {
  const sql = readFileSync('migrations/0003_queues_calls.sql', 'utf8')
  it('declares the three Phase-3 tables', () => {
    for (const t of ['cc_queues', 'cc_queue_members', 'cc_calls']) {
      expect(sql).toContain(`CREATE TABLE ${t}`)
    }
  })
  it('scopes queues + calls by org and links membership/calls to queues and agents', () => {
    expect(sql).toContain('UNIQUE (organization_id, name)')
    expect(sql).toContain('UNIQUE (organization_id, twilio_call_sid)')
    expect(sql).toContain('REFERENCES cc_queues(id)')
    expect(sql).toContain('REFERENCES cc_agents(id)')
  })
})
