import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import { insertIvrFlow, getIvrFlowById, listIvrFlows, updateIvrFlow, deleteIvrFlow, type IvrFlowStatus } from '../db/ivr-flows'
import { listQueues } from '../db/queues'
import { insertAuditLog } from '../db/audit'
import { validateFlow } from '../lib/ivr/validate'
import { emptyFlowDefinition, type IvrFlowDefinition } from '../lib/ivr/graph'

export const ivr = new Hono<Env>()

// GET /api/ivr/flows — list the org's flows (supervisor+).
ivr.get('/flows', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  return c.json({ success: true, data: await listIvrFlows(c.env.DB, orgId) })
})

// GET /api/ivr/flows/:id — one flow, definition parsed (supervisor+).
ivr.get('/flows/:id', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const flow = await getIvrFlowById(c.env.DB, orgId, c.req.param('id'))
  if (!flow) return err(c, 'not_found', 'Flow not found', 404)
  return c.json({ success: true, data: flow })
})

// POST /api/ivr/flows — create ({name}); starts as an empty starter graph (admin).
// Not validated here — a brand-new single-Start-node graph has no terminal path yet;
// validation is enforced at PUT time, per the spec.
ivr.post('/flows', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  let body: { name?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return err(c, 'bad_input', 'name is required', 400)

  const id = crypto.randomUUID()
  await insertIvrFlow(c.env.DB, { id, organizationId: orgId, name, status: 'draft', definition: emptyFlowDefinition(), updatedAt: Date.now() })
  return c.json({ success: true, data: await getIvrFlowById(c.env.DB, orgId, id) }, 201)
})

// PUT /api/ivr/flows/:id — save {name?, status?, definition?} (admin). Server-side
// validation runs whenever a new definition is supplied, or the flow would end up
// 'active' — a flow can never go live carrying an invalid graph.
ivr.put('/flows/:id', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const existing = await getIvrFlowById(c.env.DB, orgId, c.req.param('id'))
  if (!existing) return err(c, 'not_found', 'Flow not found', 404)

  let body: { name?: unknown; status?: unknown; definition?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }

  const nextStatus: IvrFlowStatus = body.status === 'draft' || body.status === 'active' ? body.status : existing.status
  const nextDefinition = body.definition !== undefined ? body.definition : existing.definition

  if (body.definition !== undefined || nextStatus === 'active') {
    const queues = await listQueues(c.env.DB, orgId)
    const result = validateFlow(nextDefinition as IvrFlowDefinition, { queueIds: queues.map((q) => q.id) })
    if (!result.valid) return err(c, 'invalid_flow', result.errors.join('; '), 400)
  }

  const patch: { name?: string; status?: IvrFlowStatus; definition?: unknown; updatedAt: number } = { updatedAt: Date.now() }
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (body.status === 'draft' || body.status === 'active') patch.status = body.status
  if (body.definition !== undefined) patch.definition = body.definition

  await updateIvrFlow(c.env.DB, orgId, existing.id, patch)
  return c.json({ success: true, data: await getIvrFlowById(c.env.DB, orgId, existing.id) })
})

// DELETE /api/ivr/flows/:id — delete + ivr.delete audit (admin).
ivr.delete('/flows/:id', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const existing = await getIvrFlowById(c.env.DB, orgId, c.req.param('id'))
  if (!existing) return err(c, 'not_found', 'Flow not found', 404)
  await deleteIvrFlow(c.env.DB, orgId, existing.id)
  await insertAuditLog(c.env.DB, {
    organizationId: orgId, userId: c.get('user')?.id ?? null, action: 'ivr.delete',
    meta: { flowId: existing.id, name: existing.name },
  })
  return c.json({ success: true, data: { id: existing.id } })
})
