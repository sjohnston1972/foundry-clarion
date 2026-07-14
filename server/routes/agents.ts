import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import { findOrgResourceByEmail, listOrgResources, getResourceSkills } from '../db/workspace'
import { insertAgent, getAgentByEmail, listAgents, setAgentStatus, type Agent } from '../db/agents'
import { snapshotAgentSkills } from '../db/skills'
import { insertAuditLog } from '../db/audit'
import { createWorker } from '../lib/twilio/provisioning'
import { pushPresence } from './realtime'

export const agents = new Hono<Env>()

// GET /api/agents — enabled agents in the org (supervisor+).
agents.get('/', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  return c.json({ success: true, data: await listAgents(c.env.DB, orgId) })
})

// GET /api/agents/candidates — Workspace resources not yet enabled (admin).
agents.get('/candidates', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const [resources, enabled] = await Promise.all([
    listOrgResources(c.env.WORKSPACE_DB, orgId),
    listAgents(c.env.DB, orgId),
  ])
  const taken = new Set(enabled.map((a) => a.email))
  return c.json({ success: true, data: resources.filter((r) => !taken.has(r.email)) })
})

// POST /api/agents/enable — enable a Workspace resource as an agent (admin).
agents.post('/enable', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  let body: { email?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) return err(c, 'bad_input', 'email is required', 400)

  if (await getAgentByEmail(c.env.DB, orgId, email)) return err(c, 'already_enabled', 'Agent already enabled', 409)

  const resource = await findOrgResourceByEmail(c.env.WORKSPACE_DB, orgId, email)
  if (!resource) return err(c, 'no_resource', 'No Workspace resource with that email in this org', 404)

  const worker = await createWorker(c.env, {
    orgId, friendlyName: resource.email, attributes: { organization_id: orgId, email: resource.email },
  })

  const id = crypto.randomUUID()
  await insertAgent(c.env.DB, {
    id, organizationId: orgId, userId: null, email: resource.email,
    workspaceResourceId: resource.id, twilioWorkerSid: worker.workerSid,
  })
  const skills = await getResourceSkills(c.env.WORKSPACE_DB, resource.id)
  await snapshotAgentSkills(c.env.DB, orgId, id, skills)

  await insertAuditLog(c.env.DB, {
    organizationId: orgId,
    userId: c.get('user')?.id ?? null,
    action: 'agent.enable',
    meta: { agentId: id, email: resource.email, dryRun: worker.dryRun, skills: skills.length },
  })

  const agent: Agent = {
    id, organizationId: orgId, userId: null, email: resource.email,
    workspaceResourceId: resource.id, twilioWorkerSid: worker.workerSid, status: 'offline', activitySid: null,
  }
  return c.json({ success: true, data: agent }, 201)
})

// POST /api/agents/status — the caller updates their own agent status (agent+).
agents.post('/status', requireClarionRole('agent'), async (c) => {
  const orgId = c.get('organizationId')
  const email = c.get('user')?.email
  if (!orgId || !email) return err(c, 'no_org', 'No organization in session', 400)
  let body: { status?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const allowed = ['offline', 'available', 'on-call', 'wrap-up']
  const status = typeof body.status === 'string' ? body.status : ''
  if (!allowed.includes(status)) return err(c, 'bad_input', `status must be one of ${allowed.join(', ')}`, 400)
  const agent = await getAgentByEmail(c.env.DB, orgId, email)
  if (!agent) return err(c, 'not_agent', 'Caller is not an enabled agent', 403)
  await setAgentStatus(c.env.DB, orgId, agent.id, status)
  await pushPresence(c.env, orgId, { identity: agent.email, status, at: Date.now() })
  return c.json({ success: true, data: { id: agent.id, status } })
})
