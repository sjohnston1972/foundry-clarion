export async function insertAuditLog(
  db: D1Database,
  entry: { organizationId: string; userId: string | null; action: string; meta?: unknown },
): Promise<void> {
  await db
    .prepare(`INSERT INTO cc_audit_log (organization_id, user_id, action, meta_json) VALUES (?, ?, ?, ?)`)
    .bind(entry.organizationId, entry.userId, entry.action, JSON.stringify(entry.meta ?? null))
    .run()
}
