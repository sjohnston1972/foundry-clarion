import type { MiddlewareHandler } from 'hono'
import type { FoundryClaims } from '@foundry/auth'
import type { Env } from '../types'
import { getClarionRole, setClarionRole, type ClarionRole } from '../db/members'
import { err } from './http'

const RANK: Record<ClarionRole, number> = { agent: 1, supervisor: 2, admin: 3 }

export async function resolveClarionRole(db: D1Database, claims: FoundryClaims): Promise<ClarionRole | null> {
  const orgId = claims.org_id
  if (!orgId) return null
  const existing = await getClarionRole(db, orgId, claims.sub)
  if (existing) return existing
  // Bootstrap: an AuthPak org owner/admin can always administer Clarion.
  if (claims.role === 'owner' || claims.role === 'admin') {
    await setClarionRole(db, orgId, claims.sub, 'admin')
    return 'admin'
  }
  return null
}

export function requireClarionRole(min: ClarionRole): MiddlewareHandler<Env> {
  return async (c, next) => {
    const role = c.get('clarionRole')
    if (!role) return err(c, 'clarion_no_access', 'No Clarion access for this user', 403)
    if (RANK[role] < RANK[min]) return err(c, 'clarion_forbidden', `Requires ${min}`, 403)
    await next()
  }
}
