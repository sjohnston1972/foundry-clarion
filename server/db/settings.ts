export type OrgSettings = { organizationId: string; recordingEnabled: boolean; announcementText: string | null }
export const DEFAULT_ANNOUNCEMENT = 'This call may be recorded for quality and training purposes.'

type SettingsRow = { organization_id: string; recording_enabled: number; announcement_text: string | null }

/** Absent row => recording OFF. Never create-on-read: an unconfigured org records nothing. */
export async function getOrgSettings(db: D1Database, orgId: string): Promise<OrgSettings> {
  const row = await db
    .prepare(`SELECT organization_id, recording_enabled, announcement_text FROM cc_org_settings WHERE organization_id = ?`)
    .bind(orgId)
    .first<SettingsRow>()
  if (!row) return { organizationId: orgId, recordingEnabled: false, announcementText: null }
  return { organizationId: row.organization_id, recordingEnabled: row.recording_enabled === 1, announcementText: row.announcement_text }
}

export async function upsertOrgSettings(
  db: D1Database, orgId: string, patch: { recordingEnabled?: boolean; announcementText?: string | null },
): Promise<OrgSettings> {
  const cur = await getOrgSettings(db, orgId)
  const next = {
    recordingEnabled: patch.recordingEnabled ?? cur.recordingEnabled,
    announcementText: patch.announcementText === undefined ? cur.announcementText : patch.announcementText,
  }
  await db
    .prepare(`INSERT INTO cc_org_settings (organization_id, recording_enabled, announcement_text, updated_at)
              VALUES (?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(organization_id) DO UPDATE SET
                recording_enabled = excluded.recording_enabled,
                announcement_text = excluded.announcement_text,
                updated_at = CURRENT_TIMESTAMP`)
    .bind(orgId, next.recordingEnabled ? 1 : 0, next.announcementText)
    .run()
  return { organizationId: orgId, ...next }
}
