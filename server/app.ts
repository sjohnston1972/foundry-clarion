import { Hono } from 'hono'
import { verifyFoundrySession } from '@foundry/auth'
import type { Env } from './types'
import { apiOnError, err } from './lib/http'
import { health } from './routes/health'
import { me } from './routes/me'
import { agents } from './routes/agents'
import { token } from './routes/token'
import { realtime } from './routes/realtime'
import { queues } from './routes/queues'
import { voice } from './routes/voice'
import { ivrVoice } from './routes/ivr-voice'
import { settings } from './routes/settings'
import { reports } from './routes/reports'
import { recordings } from './routes/recordings'
import { dev } from './routes/dev'
import { touchOrgDirectory } from './db/directory'
import { resolveClarionRole } from './lib/auth'
import { isDevAuth, devVerifyOptions } from './lib/dev-auth'

const AUTHPAK_LOGIN = 'https://authpak.foundry-ns.com/login'

export function createApp() {
  const app = new Hono<Env>().basePath('/api')
  app.onError(apiOnError)

  // Pre-gate, always public.
  app.route('/health', health)

  // Dev-only session minting: invisible (404) unless DEV_AUTH === 'true'.
  // Never set DEV_AUTH in wrangler.jsonc/CI/deploy — local wrangler dev and tests only.
  app.use('/dev/*', async (c, next) => {
    if (!isDevAuth(c.env)) return c.notFound()
    return next()
  })
  app.route('/dev', dev)

  // Twilio-called webhooks, not browser-called: outside the AuthPak gate entirely.
  // Trust is established per-request via X-Twilio-Signature (server/lib/twilio/signature.ts).
  app.route('/voice', voice)
  app.route('/voice', ivrVoice)

  // Public routing probe for the SPA gate (never 401s).
  app.get('/auth-status', async (c) => {
    const claims = await verifyFoundrySession(c.req.raw, isDevAuth(c.env) ? await devVerifyOptions() : undefined)
    let disabled = false
    if (claims?.org_id) {
      const d = await touchOrgDirectory(c.env.DB, {
        organization_id: claims.org_id, name: (claims.org_name as string) ?? claims.org_slug ?? null,
        slug: claims.org_slug ?? null, owner_email: claims.email ?? null,
      })
      disabled = d.disabled
    }
    const clarionRole = claims ? await resolveClarionRole(c.env.DB, claims) : null
    return c.json({ success: true, data: {
      authenticated: !!claims, hasOrg: !!claims?.org_id, email: claims?.email ?? null,
      orgId: claims?.org_id ?? null, orgSlug: claims?.org_slug ?? null,
      orgRole: claims?.role ?? null, clarionRole, disabled,
    } })
  })

  // Enforce gate for everything else.
  app.use('/*', async (c, next) => {
    const claims = await verifyFoundrySession(c.req.raw, isDevAuth(c.env) ? await devVerifyOptions() : undefined)
    if (!claims) {
      if (c.env.AUTH_ENFORCE === 'true') {
        const wantsHtml = (c.req.header('accept') ?? '').includes('text/html')
        if (wantsHtml) return c.redirect(`${AUTHPAK_LOGIN}?redirect_uri=${encodeURIComponent(c.req.url)}`)
        return err(c, 'unauthenticated', 'Sign in required', 401)
      }
      c.set('organizationId', null); c.set('clarionRole', null)
      return next()
    }
    const dir = claims.org_id ? await touchOrgDirectory(c.env.DB, {
      organization_id: claims.org_id, name: (claims.org_name as string) ?? claims.org_slug ?? null,
      slug: claims.org_slug ?? null, owner_email: claims.email ?? null,
    }) : { disabled: false }
    if (dir.disabled) return err(c, 'org_disabled', 'This organization is suspended', 403)
    c.set('user', { id: claims.sub, email: claims.email, emailVerified: !!claims.email_verified, name: claims.name })
    c.set('organizationId', claims.org_id ?? null)
    c.set('clarionRole', await resolveClarionRole(c.env.DB, claims))
    await next()
  })

  app.route('/me', me)
  app.route('/agents', agents)
  app.route('/token', token)
  app.route('/realtime', realtime)
  app.route('/queues', queues)
  app.route('/settings', settings)
  app.route('/reports', reports)
  app.route('/recordings', recordings)
  return app
}
