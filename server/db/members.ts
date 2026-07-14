export type ClarionRole = 'admin' | 'supervisor' | 'agent'

export async function getClarionRole(db: D1Database, orgId: string, userId: string): Promise<ClarionRole | null> {
  const row = await db
    .prepare('SELECT clarion_role FROM cc_members WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, userId)
    .first<{ clarion_role: ClarionRole }>()
  return row?.clarion_role ?? null
}

export async function setClarionRole(db: D1Database, orgId: string, userId: string, role: ClarionRole): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cc_members (organization_id, user_id, clarion_role) VALUES (?, ?, ?)
       ON CONFLICT(organization_id, user_id) DO UPDATE SET clarion_role = excluded.clarion_role`,
    )
    .bind(orgId, userId, role)
    .run()
}
