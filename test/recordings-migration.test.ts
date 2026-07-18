import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('0004_recordings migration', () => {
  const sql = readFileSync('migrations/0004_recordings.sql', 'utf8')
  it('declares the two Phase-4 tables', () => {
    for (const t of ['cc_org_settings', 'cc_recordings']) {
      expect(sql).toContain(`CREATE TABLE ${t}`)
    }
  })
  it('recording is OFF by default — the consent posture is DDL, not app logic', () => {
    expect(sql).toContain('recording_enabled INTEGER NOT NULL DEFAULT 0')
  })
  it('scopes recordings by org and links them to calls', () => {
    expect(sql).toContain('UNIQUE (organization_id, twilio_recording_sid)')
    expect(sql).toContain('REFERENCES cc_calls(id)')
    expect(sql).toContain('idx_cc_recordings_org')
  })
  it('transcript status defaults to pending', () => {
    expect(sql).toContain(`transcript_status    TEXT NOT NULL DEFAULT 'pending'`)
  })
})
