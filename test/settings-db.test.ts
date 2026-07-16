import { describe, it, expect } from 'vitest'
import { getOrgSettings, upsertOrgSettings } from '../server/db/settings'

// Minimal fake D1 backed by a plain array, mirroring test/calls-db.test.ts's memDb pattern.
function memDb() {
  const rows: Record<string, unknown>[] = []
  const bindThen = (sql: string, args: unknown[]) => ({
    async run() {
      if (sql.startsWith('INSERT INTO cc_org_settings')) {
        const existing = rows.find((r) => r.organization_id === args[0])
        if (existing) {
          existing.recording_enabled = args[1]
          existing.announcement_text = args[2]
        } else {
          rows.push({ organization_id: args[0], recording_enabled: args[1], announcement_text: args[2] })
        }
      }
      return {}
    },
    async first() {
      if (sql.includes('FROM cc_org_settings')) return rows.find((r) => r.organization_id === args[0]) ?? null
      return null
    },
  })
  return { prepare: (sql: string) => ({ bind: (...args: unknown[]) => bindThen(sql, args) }) } as unknown as D1Database
}

describe('cc_org_settings accessors', () => {
  it('default off: an org with no row returns recordingEnabled false (never create-on-read)', async () => {
    const db = memDb()
    const s = await getOrgSettings(db, 'o1')
    expect(s).toEqual({ organizationId: 'o1', recordingEnabled: false, announcementText: null })
    // Still absent after the read — no row was created.
    const again = await getOrgSettings(db, 'o1')
    expect(again.recordingEnabled).toBe(false)
  })

  it('upsert round-trips both fields and is idempotent on conflict', async () => {
    const db = memDb()
    await upsertOrgSettings(db, 'o1', { recordingEnabled: true, announcementText: 'Calls are recorded.' })
    let s = await getOrgSettings(db, 'o1')
    expect(s).toEqual({ organizationId: 'o1', recordingEnabled: true, announcementText: 'Calls are recorded.' })

    // Second upsert hits the conflict path; a partial patch keeps the other field.
    await upsertOrgSettings(db, 'o1', { recordingEnabled: false })
    s = await getOrgSettings(db, 'o1')
    expect(s).toEqual({ organizationId: 'o1', recordingEnabled: false, announcementText: 'Calls are recorded.' })

    // Explicit null clears the wording.
    await upsertOrgSettings(db, 'o1', { announcementText: null })
    s = await getOrgSettings(db, 'o1')
    expect(s.announcementText).toBeNull()
    expect(s.recordingEnabled).toBe(false)
  })

  it("does not leak another org's settings (cross-tenant)", async () => {
    const db = memDb()
    await upsertOrgSettings(db, 'o1', { recordingEnabled: true })
    const other = await getOrgSettings(db, 'o2')
    expect(other.recordingEnabled).toBe(false)
  })
})
