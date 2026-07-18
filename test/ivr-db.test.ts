import { describe, it, expect } from 'vitest'
import { insertIvrFlow, getIvrFlowById, listIvrFlows, updateIvrFlow, deleteIvrFlow } from '../server/db/ivr-flows'
import { insertVoicemail, getVoicemailById, listVoicemails } from '../server/db/voicemails'

// Minimal fake D1 backed by plain arrays, mirroring test/queues-db.test.ts's memDb pattern.
function memDb() {
  const flows: Record<string, unknown>[] = []
  const voicemails: Record<string, unknown>[] = []
  const bindThen = (sql: string, args: unknown[]) => ({
    async run() {
      if (sql.startsWith('INSERT INTO cc_ivr_flows')) {
        flows.push({
          id: args[0], organization_id: args[1], name: args[2], status: args[3],
          definition_json: args[4], updated_at: args[5],
        })
      }
      if (sql.startsWith('UPDATE cc_ivr_flows')) {
        const row = flows.find((f) => f.organization_id === args[2] && f.id === args[3])
        if (row) {
          if (sql.includes('SET name = ?')) row.name = args[0]
          if (sql.includes('SET status = ?')) row.status = args[0]
          if (sql.includes('SET definition_json = ?')) row.definition_json = args[0]
          row.updated_at = args[1]
        }
      }
      if (sql.startsWith('DELETE FROM cc_ivr_flows')) {
        const i = flows.findIndex((f) => f.organization_id === args[0] && f.id === args[1])
        if (i >= 0) flows.splice(i, 1)
      }
      if (sql.startsWith('INSERT INTO cc_voicemails')) {
        voicemails.push({
          id: args[0], organization_id: args[1], flow_id: args[2], twilio_call_sid: args[3],
          from_e164: args[4], r2_key: args[5], duration_s: args[6], created_at: args[7],
          transcript_r2_key: null, transcript_status: 'pending',
        })
      }
      return {}
    },
    async first() {
      if (sql.includes('FROM cc_ivr_flows')) return flows.find((f) => f.organization_id === args[0] && f.id === args[1]) ?? null
      if (sql.includes('FROM cc_voicemails')) return voicemails.find((v) => v.organization_id === args[0] && v.id === args[1]) ?? null
      return null
    },
    async all() {
      if (sql.includes('FROM cc_ivr_flows')) return { results: flows.filter((f) => f.organization_id === args[0]) }
      if (sql.includes('FROM cc_voicemails')) return { results: voicemails.filter((v) => v.organization_id === args[0]) }
      return { results: [] }
    },
  })
  return { prepare: (sql: string) => ({ bind: (...args: unknown[]) => bindThen(sql, args) }) } as unknown as D1Database
}

const flowDef = { entryNodeId: 'n_start', nodes: [{ id: 'n_start', type: 'start', position: { x: 0, y: 0 }, config: {} }], edges: [] }

describe('cc_ivr_flows accessors', () => {
  it('inserts and reads a flow back by id, parsing definition_json', async () => {
    const db = memDb()
    await insertIvrFlow(db, { id: 'f1', organizationId: 'o1', name: 'Main IVR', status: 'draft', definition: flowDef, updatedAt: 1000 })
    const got = await getIvrFlowById(db, 'o1', 'f1')
    expect(got?.name).toBe('Main IVR')
    expect(got?.status).toBe('draft')
    expect(got?.definition).toEqual(flowDef)
    expect((await listIvrFlows(db, 'o1')).length).toBe(1)
  })

  it('cross-tenant leak: org B cannot getIvrFlowById a flow belonging to org A', async () => {
    const db = memDb()
    await insertIvrFlow(db, { id: 'f1', organizationId: 'o1', name: 'Main IVR', status: 'draft', definition: flowDef, updatedAt: 1000 })
    expect(await getIvrFlowById(db, 'o2', 'f1')).toBeNull()
    expect((await listIvrFlows(db, 'o2')).length).toBe(0)
    expect((await listIvrFlows(db, 'o1')).length).toBe(1)
  })

  it('updates name, status, and definition independently, bumping updated_at', async () => {
    const db = memDb()
    await insertIvrFlow(db, { id: 'f1', organizationId: 'o1', name: 'Main IVR', status: 'draft', definition: flowDef, updatedAt: 1000 })
    await updateIvrFlow(db, 'o1', 'f1', { name: 'Renamed', updatedAt: 2000 })
    await updateIvrFlow(db, 'o1', 'f1', { status: 'active', updatedAt: 3000 })
    const newDef = { ...flowDef, nodes: [...flowDef.nodes] }
    await updateIvrFlow(db, 'o1', 'f1', { definition: newDef, updatedAt: 4000 })
    const got = await getIvrFlowById(db, 'o1', 'f1')
    expect(got?.name).toBe('Renamed')
    expect(got?.status).toBe('active')
    expect(got?.definition).toEqual(newDef)
    expect(got?.updatedAt).toBe(4000)
  })

  it('a cross-org update is a no-op', async () => {
    const db = memDb()
    await insertIvrFlow(db, { id: 'f1', organizationId: 'o1', name: 'Main IVR', status: 'draft', definition: flowDef, updatedAt: 1000 })
    await updateIvrFlow(db, 'o2', 'f1', { name: 'Evil rename', updatedAt: 9999 })
    expect((await getIvrFlowById(db, 'o1', 'f1'))?.name).toBe('Main IVR')
  })

  it('deletes a flow scoped to its org', async () => {
    const db = memDb()
    await insertIvrFlow(db, { id: 'f1', organizationId: 'o1', name: 'Main IVR', status: 'draft', definition: flowDef, updatedAt: 1000 })
    await deleteIvrFlow(db, 'o1', 'f1')
    expect(await getIvrFlowById(db, 'o1', 'f1')).toBeNull()
  })
})

const vm = { id: 'vm1', organizationId: 'o1', flowId: 'f1', twilioCallSid: 'CAdryrun_1', fromE164: '+15551234567', r2Key: 'orgs/o1/voicemails/CAdryrun_1/REdryrun_1.mp3', durationS: 30, createdAt: 5000 }

describe('cc_voicemails accessors', () => {
  it('inserts and reads a voicemail back by id (transcript pending)', async () => {
    const db = memDb()
    await insertVoicemail(db, vm)
    const got = await getVoicemailById(db, 'o1', 'vm1')
    expect(got?.r2Key).toBe(vm.r2Key)
    expect(got?.transcriptStatus).toBe('pending')
    expect(got?.transcriptR2Key).toBeNull()
    expect((await listVoicemails(db, 'o1')).length).toBe(1)
  })

  it('cross-tenant leak: org B cannot getVoicemailById a voicemail belonging to org A', async () => {
    const db = memDb()
    await insertVoicemail(db, vm)
    expect(await getVoicemailById(db, 'o2', 'vm1')).toBeNull()
    expect((await listVoicemails(db, 'o2')).length).toBe(0)
    expect((await listVoicemails(db, 'o1')).length).toBe(1)
  })
})
