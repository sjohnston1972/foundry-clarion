import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) => {
    const c = req.headers.get('cookie') ?? ''
    if (c.includes('fnd_session=agent')) return { sub: 'u-agent', email: 'agent@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=supervisor-b')) return { sub: 'u-sup-b', email: 'sup@beta.com', email_verified: true, org_id: 'o2', org_slug: 'beta', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=supervisor')) return { sub: 'u-sup', email: 'sup@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=admin')) return { sub: 'u-admin', email: 'boss@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'owner', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    return null
  }),
}))

import { createApp } from '../server/app'
import type { IvrFlowDefinition } from '../server/lib/ivr/graph'

// A valid flow: start -> play -> menu -[1]-> routeToQueue(q_123), -[timeout]-> hangup, -[invalid]-> play.
const validDef: IvrFlowDefinition = {
  entryNodeId: 'n_start',
  nodes: [
    { id: 'n_start', type: 'start', position: { x: 0, y: 0 }, config: {} },
    { id: 'n_hi', type: 'play', position: { x: 0, y: 0 }, config: { say: 'Hi.' } },
    { id: 'n_menu', type: 'menu', position: { x: 0, y: 0 }, config: { prompt: 'Press 1.', timeoutSeconds: 5 } },
    { id: 'n_sales', type: 'routeToQueue', position: { x: 0, y: 0 }, config: { queueId: 'q_123' } },
    { id: 'n_bye', type: 'hangup', position: { x: 0, y: 0 }, config: {} },
  ],
  edges: [
    { source: 'n_start', target: 'n_hi', branch: 'next' },
    { source: 'n_hi', target: 'n_menu', branch: 'next' },
    { source: 'n_menu', target: 'n_sales', branch: '1' },
    { source: 'n_menu', target: 'n_bye', branch: 'timeout' },
    { source: 'n_menu', target: 'n_hi', branch: 'invalid' },
  ],
}

type FakeDbHandle = D1Database & { flows: Record<string, unknown>[]; auditLog: Record<string, unknown>[] }

function fakeDb(
  clarionRole: 'agent' | 'supervisor' | null,
  seedFlows: Record<string, unknown>[] = [],
  seedVoicemails: Record<string, unknown>[] = [],
): FakeDbHandle {
  const flows: Record<string, unknown>[] = seedFlows
  const voicemails: Record<string, unknown>[] = seedVoicemails
  const queues: Record<string, unknown>[] = [
    { id: 'q_123', organization_id: 'o1', name: 'Sales', twilio_workflow_sid: 'WWtest123', strategy: 'longest-idle' },
  ]
  const auditLog: Record<string, unknown>[] = []
  const db = {
    flows,
    auditLog,
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return clarionRole ? { clarion_role: clarionRole } : null
            if (sql.includes('FROM cc_ivr_flows')) return flows.find((f) => f.organization_id === a[0] && f.id === a[1]) ?? null
            if (sql.includes('FROM cc_voicemails')) return voicemails.find((v) => v.organization_id === a[0] && v.id === a[1]) ?? null
            return null
          },
          async all() {
            if (sql.includes('FROM cc_ivr_flows')) return { results: flows.filter((f) => f.organization_id === a[0]) }
            if (sql.includes('FROM cc_queues')) return { results: queues.filter((q) => q.organization_id === a[0]) }
            if (sql.includes('FROM cc_voicemails')) return { results: voicemails.filter((v) => v.organization_id === a[0]) }
            return { results: [] }
          },
          async run() {
            if (sql.startsWith('INSERT INTO cc_ivr_flows')) {
              flows.push({ id: a[0], organization_id: a[1], name: a[2], status: a[3], definition_json: a[4], updated_at: a[5] })
            }
            if (sql.startsWith('UPDATE cc_ivr_flows')) {
              const row = flows.find((f) => f.organization_id === a[2] && f.id === a[3])
              if (row) {
                if (sql.includes('SET name = ?')) row.name = a[0]
                if (sql.includes('SET status = ?')) row.status = a[0]
                if (sql.includes('SET definition_json = ?')) row.definition_json = a[0]
                row.updated_at = a[1]
              }
            }
            if (sql.startsWith('DELETE FROM cc_ivr_flows')) {
              const i = flows.findIndex((f) => f.organization_id === a[0] && f.id === a[1])
              if (i >= 0) flows.splice(i, 1)
            }
            if (sql.startsWith('INSERT INTO cc_audit_log')) {
              auditLog.push({ organization_id: a[0], user_id: a[1], action: a[2], meta_json: a[3] })
            }
            return {}
          },
        }),
      }
    },
  }
  return db as unknown as FakeDbHandle
}

const seedFlow = (id: string, orgId: string, def: unknown, status = 'draft') => ({
  id, organization_id: orgId, name: 'Main IVR', status, definition_json: JSON.stringify(def), updated_at: 1000,
})

const seedVoicemail = (id: string, orgId: string, over: Record<string, unknown> = {}) => ({
  id, organization_id: orgId, flow_id: 'f1', twilio_call_sid: 'CAdryrun_1', from_e164: '+15551234567',
  r2_key: `orgs/${orgId}/voicemails/CAdryrun_1/${id}.mp3`, duration_s: 30, transcript_r2_key: null,
  transcript_status: 'pending', created_at: 1000, ...over,
})

function fakeR2(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed))
  return { get: async (k: string) => (store.has(k) ? { body: store.get(k)! } : null) } as unknown as R2Bucket
}

const env = (
  clarionRole: 'agent' | 'supervisor' | null,
  seedFlows: Record<string, unknown>[] = [],
  seedVoicemails: Record<string, unknown>[] = [],
  r2?: R2Bucket,
) => ({
  DB: fakeDb(clarionRole, seedFlows, seedVoicemails), AUTH_ENFORCE: 'true', RECORDINGS: r2 ?? fakeR2(),
})

describe('ivr flow routes — role gates', () => {
  it('agent gets 403 on list, get, create, put, delete', async () => {
    const e = env('agent', [seedFlow('f1', 'o1', validDef)])
    expect((await createApp().request('/api/ivr/flows', { headers: { cookie: 'fnd_session=agent' } }, e)).status).toBe(403)
    expect((await createApp().request('/api/ivr/flows/f1', { headers: { cookie: 'fnd_session=agent' } }, e)).status).toBe(403)
    expect((await createApp().request('/api/ivr/flows', {
      method: 'POST', headers: { cookie: 'fnd_session=agent', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
    }, e)).status).toBe(403)
    expect((await createApp().request('/api/ivr/flows/f1', {
      method: 'PUT', headers: { cookie: 'fnd_session=agent', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
    }, e)).status).toBe(403)
    expect((await createApp().request('/api/ivr/flows/f1', { method: 'DELETE', headers: { cookie: 'fnd_session=agent' } }, e)).status).toBe(403)
  })

  it('supervisor can list and get, but gets 403 on create/put/delete', async () => {
    const e = env('supervisor', [seedFlow('f1', 'o1', validDef)])
    expect((await createApp().request('/api/ivr/flows', { headers: { cookie: 'fnd_session=supervisor' } }, e)).status).toBe(200)
    expect((await createApp().request('/api/ivr/flows/f1', { headers: { cookie: 'fnd_session=supervisor' } }, e)).status).toBe(200)
    expect((await createApp().request('/api/ivr/flows', {
      method: 'POST', headers: { cookie: 'fnd_session=supervisor', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
    }, e)).status).toBe(403)
    expect((await createApp().request('/api/ivr/flows/f1', {
      method: 'PUT', headers: { cookie: 'fnd_session=supervisor', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }),
    }, e)).status).toBe(403)
    expect((await createApp().request('/api/ivr/flows/f1', { method: 'DELETE', headers: { cookie: 'fnd_session=supervisor' } }, e)).status).toBe(403)
  })
})

describe('ivr flow routes — create', () => {
  it('admin creates a flow with an empty starter graph (one Start node), draft status', async () => {
    const e = env(null)
    const res = await createApp().request('/api/ivr/flows', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Main IVR' }),
    }, e)
    expect(res.status).toBe(201)
    const body = (await res.json()).data
    expect(body.name).toBe('Main IVR')
    expect(body.status).toBe('draft')
    expect(body.definition).toMatchObject({ nodes: [{ type: 'start' }] })
  })

  it('rejects an empty name', async () => {
    const res = await createApp().request('/api/ivr/flows', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' }, body: JSON.stringify({ name: '' }),
    }, env(null))
    expect(res.status).toBe(400)
  })
})

describe('ivr flow routes — cross-org', () => {
  it("org B fetching org A's flow id gets 404, not 403", async () => {
    const e = env('supervisor', [seedFlow('f1', 'o1', validDef)])
    const res = await createApp().request('/api/ivr/flows/f1', { headers: { cookie: 'fnd_session=supervisor-b' } }, e)
    expect(res.status).toBe(404)
  })
})

describe('ivr flow routes — PUT save + server-side validation', () => {
  it('saves a valid definition and returns it parsed', async () => {
    const e = env(null, [seedFlow('f1', 'o1', validDef)])
    const res = await createApp().request('/api/ivr/flows/f1', {
      method: 'PUT', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ definition: validDef }),
    }, e)
    expect(res.status).toBe(200)
    expect((await res.json()).data.definition).toEqual(validDef)
  })

  it('rejects an invalid definition with 400 and a message naming the failing rule', async () => {
    const invalidDef = { ...validDef, edges: validDef.edges.filter((edge) => edge.branch !== 'invalid') }
    const e = env(null, [seedFlow('f1', 'o1', validDef)])
    const res = await createApp().request('/api/ivr/flows/f1', {
      method: 'PUT', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ definition: invalidDef }),
    }, e)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.message).toContain('invalid')
  })

  it('setting status=active re-validates the existing definition even with no definition in the body', async () => {
    // Seed a flow whose stored definition is missing the menu's "invalid" branch.
    const brokenDef = { ...validDef, edges: validDef.edges.filter((edge) => edge.branch !== 'invalid') }
    const e = env(null, [seedFlow('f1', 'o1', brokenDef)])
    const res = await createApp().request('/api/ivr/flows/f1', {
      method: 'PUT', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    }, e)
    expect(res.status).toBe(400)
  })

  it('setting status=active on a valid definition succeeds', async () => {
    const e = env(null, [seedFlow('f1', 'o1', validDef)])
    const res = await createApp().request('/api/ivr/flows/f1', {
      method: 'PUT', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'active' }),
    }, e)
    expect(res.status).toBe(200)
    expect((await res.json()).data.status).toBe('active')
  })

  it('a cross-org PUT is a 404', async () => {
    const e = env(null, [seedFlow('f1', 'o1', validDef)])
    const res = await createApp().request('/api/ivr/flows/f_missing', {
      method: 'PUT', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    }, e)
    expect(res.status).toBe(404)
  })
})

describe('ivr flow routes — DELETE', () => {
  it('deletes a flow and writes an ivr.delete audit entry', async () => {
    const e = env(null, [seedFlow('f1', 'o1', validDef)])
    const res = await createApp().request('/api/ivr/flows/f1', { method: 'DELETE', headers: { cookie: 'fnd_session=admin' } }, e)
    expect(res.status).toBe(200)
    expect(e.DB.flows.length).toBe(0)
    expect(e.DB.auditLog.some((a) => a.action === 'ivr.delete')).toBe(true)
  })

  it('a cross-org delete is a 404', async () => {
    const e = env(null, [seedFlow('f1', 'o1', validDef)])
    const res = await createApp().request('/api/ivr/flows/f_missing', { method: 'DELETE', headers: { cookie: 'fnd_session=admin' } }, e)
    expect(res.status).toBe(404)
  })
})

describe('ivr voicemail routes — role gates', () => {
  it('agent gets 403 on list and media', async () => {
    const e = env('agent', [], [seedVoicemail('vm1', 'o1')])
    expect((await createApp().request('/api/ivr/voicemails', { headers: { cookie: 'fnd_session=agent' } }, e)).status).toBe(403)
    expect((await createApp().request('/api/ivr/voicemails/vm1/media', { headers: { cookie: 'fnd_session=agent' } }, e)).status).toBe(403)
  })

  it('supervisor can list and stream media', async () => {
    const key = 'orgs/o1/voicemails/CAdryrun_1/vm1.mp3'
    const e = env('supervisor', [], [seedVoicemail('vm1', 'o1')], fakeR2({ [key]: 'audio-bytes-vm1' }))
    expect((await createApp().request('/api/ivr/voicemails', { headers: { cookie: 'fnd_session=supervisor' } }, e)).status).toBe(200)
    const media = await createApp().request('/api/ivr/voicemails/vm1/media', { headers: { cookie: 'fnd_session=supervisor' } }, e)
    expect(media.status).toBe(200)
    expect(media.headers.get('content-type')).toBe('audio/mpeg')
    expect(media.headers.get('cache-control')).toBe('private, no-store')
    expect(await media.text()).toBe('audio-bytes-vm1')
  })
})

describe('ivr voicemail routes — cross-org / not found', () => {
  it("org B fetching org A's voicemail id gets 404, not 403", async () => {
    const e = env('supervisor', [], [seedVoicemail('vm1', 'o1')])
    const res = await createApp().request('/api/ivr/voicemails/vm1/media', { headers: { cookie: 'fnd_session=supervisor-b' } }, e)
    expect(res.status).toBe(404)
  })

  it('a list only returns the caller\'s own org voicemails', async () => {
    const e = env('supervisor', [], [seedVoicemail('vm1', 'o1')])
    const res = await createApp().request('/api/ivr/voicemails', { headers: { cookie: 'fnd_session=supervisor-b' } }, e)
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual([])
  })

  it('missing R2 media object is a 404 even with a valid voicemail row', async () => {
    const e = env('supervisor', [], [seedVoicemail('vm1', 'o1')], fakeR2())
    const res = await createApp().request('/api/ivr/voicemails/vm1/media', { headers: { cookie: 'fnd_session=supervisor' } }, e)
    expect(res.status).toBe(404)
  })
})
