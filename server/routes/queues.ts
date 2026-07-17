import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import {
  insertQueue, getQueueById, listQueues, updateQueue, deleteQueue,
  addQueueMember, removeQueueMember, listQueueMembers,
} from '../db/queues'
import { createWorkflow } from '../lib/twilio/provisioning'
import { isQueueStrategy, DEFAULT_QUEUE_STRATEGY } from '../lib/queues/strategies'
import { insertAuditLog } from '../db/audit'

export const queues = new Hono<Env>()

// GET /api/queues — queues in the org (supervisor+).
queues.get('/', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  return c.json({ success: true, data: await listQueues(c.env.DB, orgId) })
})

// GET /api/queues/:id/members — an existing queue's roster (supervisor+).
queues.get('/:id/members', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const queue = await getQueueById(c.env.DB, orgId, c.req.param('id'))
  if (!queue) return err(c, 'not_found', 'Queue not found', 404)
  return c.json({ success: true, data: await listQueueMembers(c.env.DB, queue.id) })
})

// POST /api/queues — create a queue + provision its Workflow (admin, dry-run).
queues.post('/', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  let body: { name?: unknown; strategy?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return err(c, 'bad_input', 'name is required', 400)
  let strategy = DEFAULT_QUEUE_STRATEGY
  if (body.strategy !== undefined) {
    if (!isQueueStrategy(body.strategy)) return err(c, 'bad_input', 'unknown strategy', 400)
    strategy = body.strategy
  }

  const workflow = await createWorkflow(c.env, { orgId, friendlyName: name, configuration: {} })

  const id = crypto.randomUUID()
  await insertQueue(c.env.DB, { id, organizationId: orgId, name, twilioWorkflowSid: workflow.workflowSid, strategy })
  return c.json({ success: true, data: { id, organizationId: orgId, name, twilioWorkflowSid: workflow.workflowSid, strategy } }, 201)
})

// PATCH /api/queues/:id — rename or re-strategize a queue (admin).
queues.patch('/:id', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const existing = await getQueueById(c.env.DB, orgId, c.req.param('id'))
  if (!existing) return err(c, 'not_found', 'Queue not found', 404)
  let body: { name?: unknown; strategy?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const patch: { name?: string; strategy?: string } = {}
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (body.strategy !== undefined) {
    if (!isQueueStrategy(body.strategy)) return err(c, 'bad_input', 'unknown strategy', 400)
    patch.strategy = body.strategy
  }
  await updateQueue(c.env.DB, orgId, existing.id, patch)
  if (patch.strategy) {
    await insertAuditLog(c.env.DB, { organizationId: orgId, userId: c.get('user')?.id ?? null, action: 'queue.strategy', meta: { queueId: existing.id, strategy: patch.strategy } })
  }
  return c.json({ success: true, data: await getQueueById(c.env.DB, orgId, existing.id) })
})

// DELETE /api/queues/:id — remove a queue (admin).
queues.delete('/:id', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const existing = await getQueueById(c.env.DB, orgId, c.req.param('id'))
  if (!existing) return err(c, 'not_found', 'Queue not found', 404)
  await deleteQueue(c.env.DB, orgId, existing.id)
  await insertAuditLog(c.env.DB, { organizationId: orgId, userId: c.get('user')?.id ?? null, action: 'queue.delete', meta: { queueId: existing.id, name: existing.name } })
  return c.json({ success: true, data: { id: existing.id } })
})

// POST /api/queues/:id/members — assign an agent to a queue at a priority (admin).
queues.post('/:id/members', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const queue = await getQueueById(c.env.DB, orgId, c.req.param('id'))
  if (!queue) return err(c, 'not_found', 'Queue not found', 404)
  let body: { agentId?: unknown; priority?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const agentId = typeof body.agentId === 'string' ? body.agentId : ''
  if (!agentId) return err(c, 'bad_input', 'agentId is required', 400)
  const priority = typeof body.priority === 'number' ? body.priority : 0
  await addQueueMember(c.env.DB, queue.id, agentId, priority)
  return c.json({ success: true, data: { queueId: queue.id, agentId, priority } }, 201)
})

// DELETE /api/queues/:id/members/:agentId — remove an agent from a queue (admin).
queues.delete('/:id/members/:agentId', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const queue = await getQueueById(c.env.DB, orgId, c.req.param('id'))
  if (!queue) return err(c, 'not_found', 'Queue not found', 404)
  await removeQueueMember(c.env.DB, queue.id, c.req.param('agentId'))
  return c.json({ success: true, data: { queueId: queue.id, agentId: c.req.param('agentId') } })
})
