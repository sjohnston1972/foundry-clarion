export async function touchOrgDirectory(
  db: D1Database,
  o: { organization_id: string; name?: string | null; slug?: string | null; owner_email?: string | null },
): Promise<{ disabled: boolean }> {
  await db
    .prepare(
      `INSERT INTO cc_org_directory (organization_id, name, slug, owner_email, last_seen)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(organization_id) DO UPDATE SET
         name = COALESCE(excluded.name, cc_org_directory.name),
         slug = COALESCE(excluded.slug, cc_org_directory.slug),
         owner_email = COALESCE(excluded.owner_email, cc_org_directory.owner_email),
         last_seen = CURRENT_TIMESTAMP`,
    )
    .bind(o.organization_id, o.name ?? null, o.slug ?? null, o.owner_email ?? null)
    .run()
  const row = await db
    .prepare('SELECT disabled FROM cc_org_directory WHERE organization_id = ?')
    .bind(o.organization_id)
    .first<{ disabled: number }>()
  return { disabled: !!row?.disabled }
}
