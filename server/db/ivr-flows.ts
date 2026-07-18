export type IvrFlowStatus = 'draft' | 'active'

export type IvrFlow = {
  id: string
  organizationId: string
  name: string
  status: IvrFlowStatus
  definition: unknown
  updatedAt: number
}

type IvrFlowRow = {
  id: string
  organization_id: string
  name: string
  status: IvrFlowStatus
  definition_json: string
  updated_at: number
}

function toIvrFlow(r: IvrFlowRow): IvrFlow {
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    status: r.status,
    definition: JSON.parse(r.definition_json),
    updatedAt: r.updated_at,
  }
}

const COLS = 'id, organization_id, name, status, definition_json, updated_at'

export async function insertIvrFlow(
  db: D1Database,
  f: { id: string; organizationId: string; name: string; status: IvrFlowStatus; definition: unknown; updatedAt: number },
): Promise<void> {
  await db
    .prepare(`INSERT INTO cc_ivr_flows (id, organization_id, name, status, definition_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(f.id, f.organizationId, f.name, f.status, JSON.stringify(f.definition), f.updatedAt)
    .run()
}

export async function getIvrFlowById(db: D1Database, orgId: string, id: string): Promise<IvrFlow | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_ivr_flows WHERE organization_id = ? AND id = ?`)
    .bind(orgId, id)
    .first<IvrFlowRow>()
  return row ? toIvrFlow(row) : null
}

export async function listIvrFlows(db: D1Database, orgId: string): Promise<IvrFlow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM cc_ivr_flows WHERE organization_id = ? ORDER BY name`)
    .bind(orgId)
    .all<IvrFlowRow>()
  return results.map(toIvrFlow)
}

export async function updateIvrFlow(
  db: D1Database,
  orgId: string,
  id: string,
  patch: { name?: string; status?: IvrFlowStatus; definition?: unknown; updatedAt: number },
): Promise<void> {
  if (patch.name !== undefined) {
    await db.prepare(`UPDATE cc_ivr_flows SET name = ?, updated_at = ? WHERE organization_id = ? AND id = ?`).bind(patch.name, patch.updatedAt, orgId, id).run()
  }
  if (patch.status !== undefined) {
    await db.prepare(`UPDATE cc_ivr_flows SET status = ?, updated_at = ? WHERE organization_id = ? AND id = ?`).bind(patch.status, patch.updatedAt, orgId, id).run()
  }
  if (patch.definition !== undefined) {
    await db
      .prepare(`UPDATE cc_ivr_flows SET definition_json = ?, updated_at = ? WHERE organization_id = ? AND id = ?`)
      .bind(JSON.stringify(patch.definition), patch.updatedAt, orgId, id)
      .run()
  }
}

export async function deleteIvrFlow(db: D1Database, orgId: string, id: string): Promise<void> {
  await db.prepare(`DELETE FROM cc_ivr_flows WHERE organization_id = ? AND id = ?`).bind(orgId, id).run()
}
