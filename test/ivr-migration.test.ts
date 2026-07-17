import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('0005_ivr migration', () => {
  const sql = readFileSync('migrations/0005_ivr.sql', 'utf8')

  it('declares the two IVR tables', () => {
    for (const t of ['cc_ivr_flows', 'cc_voicemails']) {
      expect(sql).toContain(`CREATE TABLE ${t}`)
    }
  })

  it('flows default to draft status and are org-scoped', () => {
    expect(sql).toContain(`status           TEXT NOT NULL DEFAULT 'draft'`)
    expect(sql).toContain('idx_cc_ivr_flows_org')
  })

  it('flows store updated_at as epoch ms, passed in (no Date.now() in D1)', () => {
    expect(sql).toContain('updated_at       INTEGER NOT NULL')
  })

  it('voicemails link to flows with ON DELETE SET NULL and default transcript_status to pending', () => {
    expect(sql).toContain('REFERENCES cc_ivr_flows(id) ON DELETE SET NULL')
    expect(sql).toContain(`transcript_status    TEXT DEFAULT 'pending'`)
  })

  it('voicemails are org-scoped', () => {
    expect(sql).toContain('idx_cc_voicemails_org')
  })
})
