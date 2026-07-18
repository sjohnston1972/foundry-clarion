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

export type CallFilter = { from?: string; to?: string; queueId?: string; agentId?: string; disposition?: string }
export type CallSummary = { total: number; answered: number; abandoned: number; avgDurationS: number }

/** Builds a WHERE from bound values only — column names are never interpolated. */
function whereFor(orgId: string, f: CallFilter): { sql: string; binds: (string | number)[] } {
  const clauses = ['organization_id = ?']
  const binds: (string | number)[] = [orgId]
  if (f.from) { clauses.push('started_at >= ?'); binds.push(f.from) }
  if (f.to) { clauses.push('started_at <= ?'); binds.push(f.to) }
  if (f.queueId) { clauses.push('queue_id = ?'); binds.push(f.queueId) }
  if (f.agentId) { clauses.push('agent_id = ?'); binds.push(f.agentId) }
  if (f.disposition) { clauses.push('disposition = ?'); binds.push(f.disposition) }
  return { sql: clauses.join(' AND '), binds }
}

export async function queryCalls(db: D1Database, orgId: string, f: CallFilter): Promise<Call[]> {
  const { sql, binds } = whereFor(orgId, f)
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM cc_calls WHERE ${sql} ORDER BY started_at DESC LIMIT 500`)
    .bind(...binds)
    .all<CallRow>()
  return results.map(toCall)
}

export async function summarizeCalls(db: D1Database, orgId: string, f: CallFilter): Promise<CallSummary> {
  const { sql, binds } = whereFor(orgId, f)
  const row = await db
    .prepare(`SELECT COUNT(*) AS total,
                     SUM(CASE WHEN agent_id IS NOT NULL THEN 1 ELSE 0 END) AS answered,
                     SUM(CASE WHEN agent_id IS NULL THEN 1 ELSE 0 END) AS abandoned,
                     COALESCE(AVG(duration_s), 0) AS avg_duration_s
              FROM cc_calls WHERE ${sql}`)
    .bind(...binds)
    .first<{ total: number; answered: number; abandoned: number; avg_duration_s: number }>()
  return {
    total: row?.total ?? 0, answered: row?.answered ?? 0, abandoned: row?.abandoned ?? 0,
    avgDurationS: Math.round(row?.avg_duration_s ?? 0),
  }
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
