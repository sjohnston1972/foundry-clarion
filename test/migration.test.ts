import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('0001_init migration', () => {
  it('declares the three Phase-1 tables', () => {
    const sql = readFileSync('migrations/0001_init.sql', 'utf8')
    for (const t of ['cc_org_directory', 'cc_members', 'cc_audit_log']) {
      expect(sql).toContain(`CREATE TABLE ${t}`)
    }
    expect(sql).toContain('clarion_role') // role column present
  })
})
