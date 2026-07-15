export type Queue = {
  id: string
  organizationId: string
  name: string
  twilioWorkflowSid: string | null
  strategy: string
}

type QueueRow = {
  id: string
  organization_id: string
  name: string
  twilio_workflow_sid: string | null
  strategy: string
}

function toQueue(r: QueueRow): Queue {
  return {
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    twilioWorkflowSid: r.twilio_workflow_sid,
    strategy: r.strategy,
  }
}

const COLS = 'id, organization_id, name, twilio_workflow_sid, strategy'

export async function insertQueue(
  db: D1Database,
  q: { id: string; organizationId: string; name: string; twilioWorkflowSid: string | null; strategy: string },
): Promise<void> {
  await db
    .prepare(`INSERT INTO cc_queues (id, organization_id, name, twilio_workflow_sid, strategy) VALUES (?, ?, ?, ?, ?)`)
    .bind(q.id, q.organizationId, q.name, q.twilioWorkflowSid, q.strategy)
    .run()
}

export async function getQueueById(db: D1Database, orgId: string, id: string): Promise<Queue | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_queues WHERE organization_id = ? AND id = ?`)
    .bind(orgId, id)
    .first<QueueRow>()
  return row ? toQueue(row) : null
}

export async function listQueues(db: D1Database, orgId: string): Promise<Queue[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM cc_queues WHERE organization_id = ? ORDER BY name`)
    .bind(orgId)
    .all<QueueRow>()
  return results.map(toQueue)
}

export async function deleteQueue(db: D1Database, orgId: string, id: string): Promise<void> {
  await db.prepare(`DELETE FROM cc_queues WHERE organization_id = ? AND id = ?`).bind(orgId, id).run()
}

export async function addQueueMember(db: D1Database, queueId: string, agentId: string, priority: number): Promise<void> {
  await db
    .prepare(`INSERT INTO cc_queue_members (queue_id, agent_id, priority) VALUES (?, ?, ?)
              ON CONFLICT(queue_id, agent_id) DO UPDATE SET priority = excluded.priority`)
    .bind(queueId, agentId, priority)
    .run()
}

export async function removeQueueMember(db: D1Database, queueId: string, agentId: string): Promise<void> {
  await db.prepare(`DELETE FROM cc_queue_members WHERE queue_id = ? AND agent_id = ?`).bind(queueId, agentId).run()
}

export type QueueMember = { queueId: string; agentId: string; priority: number }

export async function listQueueMembers(db: D1Database, queueId: string): Promise<QueueMember[]> {
  const { results } = await db
    .prepare(`SELECT queue_id, agent_id, priority FROM cc_queue_members WHERE queue_id = ? ORDER BY priority DESC`)
    .bind(queueId)
    .all<{ queue_id: string; agent_id: string; priority: number }>()
  return results.map((r) => ({ queueId: r.queue_id, agentId: r.agent_id, priority: r.priority }))
}
