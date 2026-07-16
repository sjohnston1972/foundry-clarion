export type TranscriptStatus = 'pending' | 'done' | 'failed' | 'skipped'

export type Recording = {
  id: string
  organizationId: string
  callId: string
  twilioRecordingSid: string
  r2Key: string
  durationS: number | null
  transcriptR2Key: string | null
  transcriptStatus: TranscriptStatus
}

type RecordingRow = {
  id: string
  organization_id: string
  call_id: string
  twilio_recording_sid: string
  r2_key: string
  duration_s: number | null
  transcript_r2_key: string | null
  transcript_status: TranscriptStatus
}

function toRecording(r: RecordingRow): Recording {
  return {
    id: r.id,
    organizationId: r.organization_id,
    callId: r.call_id,
    twilioRecordingSid: r.twilio_recording_sid,
    r2Key: r.r2_key,
    durationS: r.duration_s,
    transcriptR2Key: r.transcript_r2_key,
    transcriptStatus: r.transcript_status,
  }
}

const COLS = 'id, organization_id, call_id, twilio_recording_sid, r2_key, duration_s, transcript_r2_key, transcript_status'

export async function insertRecording(
  db: D1Database,
  r: { id: string; organizationId: string; callId: string; twilioRecordingSid: string; r2Key: string; durationS: number | null },
): Promise<void> {
  await db
    .prepare(`INSERT INTO cc_recordings (id, organization_id, call_id, twilio_recording_sid, r2_key, duration_s) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(r.id, r.organizationId, r.callId, r.twilioRecordingSid, r.r2Key, r.durationS)
    .run()
}

export async function getRecordingById(db: D1Database, orgId: string, id: string): Promise<Recording | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_recordings WHERE organization_id = ? AND id = ?`)
    .bind(orgId, id)
    .first<RecordingRow>()
  return row ? toRecording(row) : null
}

export async function listRecordingsForCall(db: D1Database, orgId: string, callId: string): Promise<Recording[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM cc_recordings WHERE organization_id = ? AND call_id = ? ORDER BY created_at`)
    .bind(orgId, callId)
    .all<RecordingRow>()
  return results.map(toRecording)
}

export async function setTranscript(
  db: D1Database,
  orgId: string,
  id: string,
  patch: { transcriptR2Key: string | null; transcriptStatus: TranscriptStatus },
): Promise<void> {
  await db
    .prepare(`UPDATE cc_recordings SET transcript_r2_key = ?, transcript_status = ? WHERE organization_id = ? AND id = ?`)
    .bind(patch.transcriptR2Key, patch.transcriptStatus, orgId, id)
    .run()
}
