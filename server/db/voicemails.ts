export type TranscriptStatus = 'pending' | 'done' | 'failed' | 'skipped'

export type Voicemail = {
  id: string
  organizationId: string
  flowId: string | null
  twilioCallSid: string
  fromE164: string | null
  r2Key: string
  durationS: number | null
  transcriptR2Key: string | null
  transcriptStatus: TranscriptStatus
  createdAt: number
}

type VoicemailRow = {
  id: string
  organization_id: string
  flow_id: string | null
  twilio_call_sid: string
  from_e164: string | null
  r2_key: string
  duration_s: number | null
  transcript_r2_key: string | null
  transcript_status: TranscriptStatus
  created_at: number
}

function toVoicemail(r: VoicemailRow): Voicemail {
  return {
    id: r.id,
    organizationId: r.organization_id,
    flowId: r.flow_id,
    twilioCallSid: r.twilio_call_sid,
    fromE164: r.from_e164,
    r2Key: r.r2_key,
    durationS: r.duration_s,
    transcriptR2Key: r.transcript_r2_key,
    transcriptStatus: r.transcript_status,
    createdAt: r.created_at,
  }
}

const COLS = 'id, organization_id, flow_id, twilio_call_sid, from_e164, r2_key, duration_s, transcript_r2_key, transcript_status, created_at'

export async function insertVoicemail(
  db: D1Database,
  v: {
    id: string
    organizationId: string
    flowId: string | null
    twilioCallSid: string
    fromE164: string | null
    r2Key: string
    durationS: number | null
    createdAt: number
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cc_voicemails (id, organization_id, flow_id, twilio_call_sid, from_e164, r2_key, duration_s, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(v.id, v.organizationId, v.flowId, v.twilioCallSid, v.fromE164, v.r2Key, v.durationS, v.createdAt)
    .run()
}

export async function getVoicemailById(db: D1Database, orgId: string, id: string): Promise<Voicemail | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_voicemails WHERE organization_id = ? AND id = ?`)
    .bind(orgId, id)
    .first<VoicemailRow>()
  return row ? toVoicemail(row) : null
}

export async function listVoicemails(db: D1Database, orgId: string): Promise<Voicemail[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM cc_voicemails WHERE organization_id = ? ORDER BY created_at DESC`)
    .bind(orgId)
    .all<VoicemailRow>()
  return results.map(toVoicemail)
}
