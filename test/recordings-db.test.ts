import { describe, it, expect } from 'vitest'
import { insertRecording, getRecordingById, listRecordingsForCall, setTranscript } from '../server/db/recordings'

// Minimal fake D1 backed by a plain array, mirroring test/calls-db.test.ts's memDb pattern.
function memDb() {
  const recordings: Record<string, unknown>[] = []
  const bindThen = (sql: string, args: unknown[]) => ({
    async run() {
      if (sql.startsWith('INSERT INTO cc_recordings')) {
        recordings.push({
          id: args[0], organization_id: args[1], call_id: args[2], twilio_recording_sid: args[3],
          r2_key: args[4], duration_s: args[5], transcript_r2_key: null, transcript_status: 'pending',
        })
      }
      if (sql.startsWith('UPDATE cc_recordings')) {
        const row = recordings.find((r) => r.organization_id === args[2] && r.id === args[3])
        if (row) { row.transcript_r2_key = args[0]; row.transcript_status = args[1] }
      }
      return {}
    },
    async first() {
      if (sql.includes('FROM cc_recordings')) return recordings.find((r) => r.organization_id === args[0] && r.id === args[1]) ?? null
      return null
    },
    async all() {
      if (sql.includes('FROM cc_recordings')) return { results: recordings.filter((r) => r.organization_id === args[0] && r.call_id === args[1]) }
      return { results: [] }
    },
  })
  return { prepare: (sql: string) => ({ bind: (...args: unknown[]) => bindThen(sql, args) }) } as unknown as D1Database
}

const rec = { id: 'rec1', organizationId: 'o1', callId: 'c1', twilioRecordingSid: 'REdryrun_1', r2Key: 'orgs/o1/calls/CA1/REdryrun_1.mp3', durationS: 42 }

describe('cc_recordings accessors', () => {
  it('inserts and reads a recording back by id (transcript pending)', async () => {
    const db = memDb()
    await insertRecording(db, rec)
    const got = await getRecordingById(db, 'o1', 'rec1')
    expect(got?.r2Key).toBe('orgs/o1/calls/CA1/REdryrun_1.mp3')
    expect(got?.transcriptStatus).toBe('pending')
    expect(got?.transcriptR2Key).toBeNull()
    expect((await listRecordingsForCall(db, 'o1', 'c1')).length).toBe(1)
  })

  it("cross-tenant leak: org B cannot getRecordingById a recording belonging to org A", async () => {
    const db = memDb()
    await insertRecording(db, rec)
    expect(await getRecordingById(db, 'o2', 'rec1')).toBeNull()
    expect((await listRecordingsForCall(db, 'o2', 'c1')).length).toBe(0)
  })

  it('setTranscript updates key + status, org-scoped', async () => {
    const db = memDb()
    await insertRecording(db, rec)
    // A cross-org update must be a no-op.
    await setTranscript(db, 'o2', 'rec1', { transcriptR2Key: 'evil', transcriptStatus: 'done' })
    expect((await getRecordingById(db, 'o1', 'rec1'))?.transcriptStatus).toBe('pending')

    await setTranscript(db, 'o1', 'rec1', { transcriptR2Key: 'orgs/o1/calls/CA1/REdryrun_1.transcript.json', transcriptStatus: 'done' })
    const got = await getRecordingById(db, 'o1', 'rec1')
    expect(got?.transcriptStatus).toBe('done')
    expect(got?.transcriptR2Key).toBe('orgs/o1/calls/CA1/REdryrun_1.transcript.json')
  })
})
