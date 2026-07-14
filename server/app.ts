import { Hono } from 'hono'
import { verifyFoundrySession } from '@foundry/auth'
import type { Env } from './types'
import { apiOnError, err } from './lib/http'
import { health } from './routes/health'
import { me } from './routes/me'
import { agents } from './routes/agents'
import { touchOrgDirectory } from './db/directory'
import { resolveClarionRole } from './lib/auth'

const AUTHPAK_LOGIN = 'https://authpak.foundry-ns.com/login'

export function createApp() {
  const app = new Hono<Env>().basePath('/api')
  app.onError(apiOnError)

  // Pre-gate, always public.
  app.route('/health', health)

  // Public routing probe for the SPA gate (never 401s).
  app.get('/auth-status', async (c) => {
    const claims = await verifyFoundrySession(c.req.raw)
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
    const claims = await verifyFoundrySession(c.req.raw)
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
  return app
}
