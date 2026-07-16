import type { WorkspaceSkill } from './workspace'

export async function upsertSkill(db: D1Database, orgId: string, name: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM cc_skills WHERE organization_id = ? AND name = ?`)
    .bind(orgId, name)
    .first<{ id: string }>()
  if (existing) return existing.id
  const id = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO cc_skills (id, organization_id, name) VALUES (?, ?, ?)
              ON CONFLICT(organization_id, name) DO NOTHING`)
    .bind(id, orgId, name)
    .run()
  // Re-read in case a concurrent insert won the conflict.
  const row = await db
    .prepare(`SELECT id FROM cc_skills WHERE organization_id = ? AND name = ?`)
    .bind(orgId, name)
    .first<{ id: string }>()
  return row?.id ?? id
}

export async function snapshotAgentSkills(
  db: D1Database,
  orgId: string,
  agentId: string,
  skills: WorkspaceSkill[],
): Promise<void> {
  for (const s of skills) {
    const skillId = await upsertSkill(db, orgId, s.name)
    await db
      .prepare(`INSERT INTO cc_agent_skills (agent_id, skill_id, proficiency, synced_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(agent_id, skill_id) DO UPDATE SET proficiency = excluded.proficiency, synced_at = CURRENT_TIMESTAMP`)
      .bind(agentId, skillId, s.level)
      .run()
  }
}
