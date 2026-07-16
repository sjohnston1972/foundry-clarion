import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import { getAgentByEmail } from '../db/agents'
import { mintVoiceToken } from '../lib/twilio/token'

export const token = new Hono<Env>()

// POST /api/token/voice — a short-lived Twilio Access Token for the caller's softphone (agent+).
token.post('/voice', requireClarionRole('agent'), async (c) => {
  const orgId = c.get('organizationId')
  const email = c.get('user')?.email
  if (!orgId || !email) return err(c, 'no_org', 'No organization in session', 400)
  const agent = await getAgentByEmail(c.env.DB, orgId, email)
  if (!agent) return err(c, 'not_agent', 'Caller is not an enabled agent', 403)
  if (!agent.twilioWorkerSid) return err(c, 'no_worker', 'Agent has no Twilio worker yet', 409)
  try {
    const minted = await mintVoiceToken(c.env, { identity: agent.email, workerSid: agent.twilioWorkerSid })
    return c.json({ success: true, data: minted })
  } catch (e) {
    if ((e as Error).message === 'twilio_not_configured') {
      return err(c, 'twilio_not_configured', 'Twilio is not configured on the server yet', 503)
    }
    throw e
  }
})
