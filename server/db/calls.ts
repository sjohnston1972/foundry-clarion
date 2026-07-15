export type Call = {
  id: string
  organizationId: string
  twilioCallSid: string
  fromE164: string
  toE164: string
  queueId: string | null
  agentId: string | null
  disposition: string | null
  durationS: number | null
}

type CallRow = {
  id: string
  organization_id: string
  twilio_call_sid: string
  from_e164: string
  to_e164: string
  queue_id: string | null
  agent_id: string | null
  disposition: string | null
  duration_s: number | null
}

function toCall(r: CallRow): Call {
  return {
    id: r.id,
    organizationId: r.organization_id,
    twilioCallSid: r.twilio_call_sid,
    fromE164: r.from_e164,
    toE164: r.to_e164,
    queueId: r.queue_id,
    agentId: r.agent_id,
    disposition: r.disposition,
    durationS: r.duration_s,
  }
}

const COLS = 'id, organization_id, twilio_call_sid, from_e164, to_e164, queue_id, agent_id, disposition, duration_s'

export async function insertCall(
  db: D1Database,
  c: { id: string; organizationId: string; twilioCallSid: string; fromE164: string; toE164: string; queueId: string | null },
): Promise<void> {
  await db
    .prepare(`INSERT INTO cc_calls (id, organization_id, twilio_call_sid, from_e164, to_e164, queue_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(c.id, c.organizationId, c.twilioCallSid, c.fromE164, c.toE164, c.queueId)
    .run()
}

export async function getCallBySid(db: D1Database, orgId: string, twilioCallSid: string): Promise<Call | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_calls WHERE organization_id = ? AND twilio_call_sid = ?`)
    .bind(orgId, twilioCallSid)
    .first<CallRow>()
  return row ? toCall(row) : null
}

export async function listCallsForOrg(db: D1Database, orgId: string): Promise<Call[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM cc_calls WHERE organization_id = ? ORDER BY started_at DESC`)
    .bind(orgId)
    .all<CallRow>()
  return results.map(toCall)
}

export async function updateCallOutcome(
  db: D1Database,
  orgId: string,
  twilioCallSid: string,
  outcome: { disposition: string | null; durationS: number | null; agentId: string | null },
): Promise<void> {
  await db
    .prepare(`UPDATE cc_calls SET disposition = ?, duration_s = ?, agent_id = ? WHERE organization_id = ? AND twilio_call_sid = ?`)
    .bind(outcome.disposition, outcome.durationS, outcome.agentId, orgId, twilioCallSid)
    .run()
}
