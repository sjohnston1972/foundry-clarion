import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) => {
    const c = req.headers.get('cookie') ?? ''
    if (c.includes('fnd_session=agent')) return { sub: 'u-agent', email: 'agent@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=supervisor')) return { sub: 'u-sup', email: 'sup@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    if (c.includes('fnd_session=admin')) return { sub: 'u-admin', email: 'boss@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'owner', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    return null
  }),
}))

import { createApp } from '../server/app'

// clarionRole fixed per test; null => owner/admin JWT role bootstraps to 'admin'.
// Exposes the settings + audit stores for assertions.
function fakeDb(clarionRole: 'agent' | 'supervisor' | null) {
  const settingsRows: Record<string, unknown>[] = []
  const auditRows: Record<string, unknown>[] = []
  const db = {
    settingsRows,
    auditRows,
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return clarionRole ? { clarion_role: clarionRole } : null
            if (sql.includes('FROM cc_org_settings')) return settingsRows.find((r) => r.organization_id === a[0]) ?? null
            return null
          },
          async run() {
            if (sql.startsWith('INSERT INTO cc_org_settings')) {
              const existing = settingsRows.find((r) => r.organization_id === a[0])
              if (existing) { existing.recording_enabled = a[1]; existing.announcement_text = a[2] }
              else settingsRows.push({ organization_id: a[0], recording_enabled: a[1], announcement_text: a[2] })
            }
            if (sql.startsWith('INSERT INTO cc_audit_log')) {
              auditRows.push({ organization_id: a[0], user_id: a[1], action: a[2], meta_json: a[3] })
            }
            return {}
          },
        }),
      }
    },
  }
  return db as unknown as D1Database & { settingsRows: Record<string, unknown>[]; auditRows: Record<string, unknown>[] }
}

const env = (clarionRole: 'agent' | 'supervisor' | null) => ({ DB: fakeDb(clarionRole), AUTH_ENFORCE: 'true' })

const patchReq = (bodyJson: unknown, cookie: string) => ({
  method: 'PATCH' as const,
  headers: { cookie, 'content-type': 'application/json' },
  body: JSON.stringify(bodyJson),
})

describe('settings route — role gates', () => {
  it('agent gets 403 on both verbs', async () => {
    const e = env('agent')
    const get = await createApp().request('/api/settings', { headers: { cookie: 'fnd_session=agent' } }, e)
    expect(get.status).toBe(403)
    const patch = await createApp().request('/api/settings', patchReq({ recordingEnabled: true }, 'fnd_session=agent'), e)
    expect(patch.status).toBe(403)
  })

  it('supervisor gets 403 on PATCH', async () => {
    const res = await createApp().request('/api/settings', patchReq({ recordingEnabled: true }, 'fnd_session=supervisor'), env('supervisor'))
    expect(res.status).toBe(403)
  })

  it('admin gets 200 on GET, with the default-off posture for an unconfigured org', async () => {
    const res = await createApp().request('/api/settings', { headers: { cookie: 'fnd_session=admin' } }, env(null))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ organizationId: 'o1', recordingEnabled: false, announcementText: null })
  })
})

describe('settings route — PATCH', () => {
  it('round-trips: enable + wording persist and GET reflects them; an audit row is written', async () => {
    const e = env(null)
    const app = createApp()
    const patch = await app.request('/api/settings', patchReq({ recordingEnabled: true, announcementText: 'Calls are recorded.' }, 'fnd_session=admin'), e)
    expect(patch.status).toBe(200)
    expect((await patch.json()).data).toEqual({ organizationId: 'o1', recordingEnabled: true, announcementText: 'Calls are recorded.' })

    const get = await app.request('/api/settings', { headers: { cookie: 'fnd_session=admin' } }, e)
    expect((await get.json()).data).toMatchObject({ recordingEnabled: true, announcementText: 'Calls are recorded.' })

    const audit = (e.DB as ReturnType<typeof fakeDb>).auditRows
    expect(audit.length).toBe(1)
    expect(audit[0]).toMatchObject({ organization_id: 'o1', user_id: 'u-admin', action: 'settings.update' })
    expect(JSON.parse(String(audit[0].meta_json))).toMatchObject({ recordingEnabled: true })
  })

  it('rejects a non-boolean recordingEnabled with bad_input 400 (and writes no audit row)', async () => {
    const e = env(null)
    const res = await createApp().request('/api/settings', patchReq({ recordingEnabled: 'yes' }, 'fnd_session=admin'), e)
    expect(res.status).toBe(400)
    expect((await res.json()).error.code).toBe('bad_input')
    expect((e.DB as ReturnType<typeof fakeDb>).auditRows.length).toBe(0)
  })
})
