import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import { getRecordingById, listRecordingsForCall } from '../db/recordings'

// Recorded audio is the most sensitive data Clarion holds: supervisor+ only, and a
// cross-org read returns 404, never 403 — a 403 would confirm the id exists.
export const recordings = new Hono<Env>()

// GET /api/recordings?callId=... — a call's recording metadata (supervisor+). The
// Reports page needs recording ids to source media/transcript; listRecordingsForCall
// exists for exactly this consumer (org-scoped, cross-org callIds yield []).
recordings.get('/', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const callId = c.req.query('callId')
  if (!callId) return err(c, 'bad_input', 'callId is required', 400)
  return c.json({ success: true, data: await listRecordingsForCall(c.env.DB, orgId, callId) })
})

// GET /api/recordings/:id/media — stream the audio from R2 (supervisor+).
recordings.get('/:id/media', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const rec = await getRecordingById(c.env.DB, orgId, c.req.param('id'))
  if (!rec) return err(c, 'not_found', 'Recording not found', 404) // cross-org => 404, never 403
  const obj = await c.env.RECORDINGS.get(rec.r2Key)
  if (!obj) return err(c, 'not_found', 'Recording media not found', 404)
  return new Response(obj.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' } })
})

// GET /api/recordings/:id/transcript — transcript JSON from R2 (supervisor+).
recordings.get('/:id/transcript', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const rec = await getRecordingById(c.env.DB, orgId, c.req.param('id'))
  if (!rec) return err(c, 'not_found', 'Recording not found', 404) // cross-org => 404, never 403
  if (!rec.transcriptR2Key) return err(c, 'not_found', 'Transcript not available', 404)
  const obj = await c.env.RECORDINGS.get(rec.transcriptR2Key)
  if (!obj) return err(c, 'not_found', 'Transcript not found', 404)
  return new Response(obj.body, { headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } })
})
