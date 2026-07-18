import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import { getOrgSettings, upsertOrgSettings } from '../db/settings'
import { insertAuditLog } from '../db/audit'

export const settings = new Hono<Env>()

// GET /api/settings — the org's recording settings (admin).
settings.get('/', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  return c.json({ success: true, data: await getOrgSettings(c.env.DB, orgId) })
})

// PATCH /api/settings — toggle recording / set announcement wording (admin, audited).
settings.patch('/', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  let body: { recordingEnabled?: unknown; announcementText?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }

  const patch: { recordingEnabled?: boolean; announcementText?: string | null } = {}
  if (body.recordingEnabled !== undefined) {
    if (typeof body.recordingEnabled !== 'boolean') return err(c, 'bad_input', 'recordingEnabled must be a boolean', 400)
    patch.recordingEnabled = body.recordingEnabled
  }
  if (body.announcementText !== undefined) {
    if (body.announcementText !== null && typeof body.announcementText !== 'string') {
      return err(c, 'bad_input', 'announcementText must be a string or null', 400)
    }
    patch.announcementText = body.announcementText
  }

  const next = await upsertOrgSettings(c.env.DB, orgId, patch)
  // Enabling recording is exactly the kind of change the audit log exists for (CLAUDE.md §6).
  await insertAuditLog(c.env.DB, {
    organizationId: orgId,
    userId: c.get('user')?.id ?? null,
    action: 'settings.update',
    meta: { recordingEnabled: next.recordingEnabled, announcementText: next.announcementText },
  })
  return c.json({ success: true, data: next })
})
