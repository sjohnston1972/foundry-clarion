import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import { queryCalls, summarizeCalls, type CallFilter } from '../db/calls'

export const reports = new Hono<Env>()

// GET /api/reports/calls — filtered call rows + aggregates (supervisor+).
reports.get('/calls', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const q = (k: string) => c.req.query(k) || undefined
  const filter: CallFilter = {
    from: q('from'), to: q('to'), queueId: q('queueId'), agentId: q('agentId'), disposition: q('disposition'),
  }
  const [calls, summary] = await Promise.all([
    queryCalls(c.env.DB, orgId, filter),
    summarizeCalls(c.env.DB, orgId, filter),
  ])
  return c.json({ success: true, data: { calls, summary } })
})
