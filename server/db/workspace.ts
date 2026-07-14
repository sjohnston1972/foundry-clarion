// READ-ONLY accessors over the Workspace D1 (skills-foundry-db), bound as WORKSPACE_DB.
// NEVER write here. Org scoping is via departments.organization_id (Workspace migration 0008).
export type WorkspaceResource = { id: string; name: string; email: string; jobRole: string | null }
export type WorkspaceSkill = { subSkillId: number; name: string; level: number | null }

type ResourceRow = { id: string; name: string; email: string; job_role: string | null }

function toResource(r: ResourceRow): WorkspaceResource {
  return { id: r.id, name: r.name, email: r.email.toLowerCase(), jobRole: r.job_role }
}

export async function listOrgResources(wdb: D1Database, orgId: string): Promise<WorkspaceResource[]> {
  const { results } = await wdb
    .prepare(
      `SELECT r.id, r.name, r.email, r.job_role
         FROM resources r JOIN departments d ON r.department_id = d.id
        WHERE d.organization_id = ? AND r.email IS NOT NULL
        ORDER BY r.name`,
    )
    .bind(orgId)
    .all<ResourceRow>()
  return results.map(toResource)
}

export async function findOrgResourceByEmail(
  wdb: D1Database,
  orgId: string,
  email: string,
): Promise<WorkspaceResource | null> {
  const row = await wdb
    .prepare(
      `SELECT r.id, r.name, r.email, r.job_role
         FROM resources r JOIN departments d ON r.department_id = d.id
        WHERE d.organization_id = ? AND lower(r.email) = lower(?)
        LIMIT 1`,
    )
    .bind(orgId, email)
    .first<ResourceRow>()
  return row ? toResource(row) : null
}

export async function getResourceSkills(wdb: D1Database, resourceId: string): Promise<WorkspaceSkill[]> {
  const { results } = await wdb
    .prepare(
      `SELECT rss.sub_skill_id AS sub_skill_id, ss.name AS name, rss.level AS level
         FROM resource_sub_skills rss JOIN sub_skills ss ON rss.sub_skill_id = ss.id
        WHERE rss.resource_id = ?`,
    )
    .bind(resourceId)
    .all<{ sub_skill_id: number; name: string; level: number | null }>()
  return results.map((s) => ({ subSkillId: s.sub_skill_id, name: s.name, level: s.level }))
}
