export type Agent = {
  id: string
  organizationId: string
  userId: string | null
  email: string
  workspaceResourceId: string | null
  twilioWorkerSid: string | null
  status: string
  activitySid: string | null
}

type AgentRow = {
  id: string
  organization_id: string
  user_id: string | null
  email: string
  workspace_resource_id: string | null
  twilio_worker_sid: string | null
  status: string
  activity_sid: string | null
}

function toAgent(r: AgentRow): Agent {
  return {
    id: r.id,
    organizationId: r.organization_id,
    userId: r.user_id,
    email: r.email,
    workspaceResourceId: r.workspace_resource_id,
    twilioWorkerSid: r.twilio_worker_sid,
    status: r.status,
    activitySid: r.activity_sid,
  }
}

const COLS = 'id, organization_id, user_id, email, workspace_resource_id, twilio_worker_sid, status, activity_sid'

export async function insertAgent(
  db: D1Database,
  a: { id: string; organizationId: string; userId: string | null; email: string; workspaceResourceId: string | null; twilioWorkerSid: string | null },
): Promise<void> {
  await db
    .prepare(`INSERT INTO cc_agents (id, organization_id, user_id, email, workspace_resource_id, twilio_worker_sid) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(a.id, a.organizationId, a.userId, a.email.toLowerCase(), a.workspaceResourceId, a.twilioWorkerSid)
    .run()
}

export async function getAgentByEmail(db: D1Database, orgId: string, email: string): Promise<Agent | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_agents WHERE organization_id = ? AND email = ?`)
    .bind(orgId, email.toLowerCase())
    .first<AgentRow>()
  return row ? toAgent(row) : null
}

export async function listAgents(db: D1Database, orgId: string): Promise<Agent[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM cc_agents WHERE organization_id = ? ORDER BY email`)
    .bind(orgId)
    .all<AgentRow>()
  return results.map(toAgent)
}

export async function setAgentStatus(db: D1Database, orgId: string, agentId: string, status: string): Promise<void> {
  await db
    .prepare(`UPDATE cc_agents SET status = ? WHERE organization_id = ? AND id = ?`)
    .bind(status, orgId, agentId)
    .run()
}

export async function getAgentById(db: D1Database, orgId: string, id: string): Promise<Agent | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_agents WHERE organization_id = ? AND id = ?`)
    .bind(orgId, id)
    .first<AgentRow>()
  return row ? toAgent(row) : null
}

export async function deleteAgent(db: D1Database, orgId: string, id: string): Promise<void> {
  await db.prepare(`DELETE FROM cc_agents WHERE organization_id = ? AND id = ?`).bind(orgId, id).run()
}
