import { describe, it, expect } from 'vitest'
import { resolveClarionRole } from '../server/lib/auth'

function db(existingRole: string | null) {
  const calls: string[] = []
  const d = {
    prepare(sql: string) {
      calls.push(sql)
      return {
        bind: () => ({
          first: async () => (sql.startsWith('SELECT') ? (existingRole ? { clarion_role: existingRole } : null) : null),
          run: async () => ({}),
        }),
      }
    },
  } as unknown as D1Database
  return { d, calls }
}

describe('resolveClarionRole', () => {
  it('returns the stored role', async () => {
    const { d } = db('supervisor')
    const role = await resolveClarionRole(d, { sub: 'u1', org_id: 'o1', role: 'member' } as never)
    expect(role).toBe('supervisor')
  })
  it('bootstraps an org owner with no row to admin', async () => {
    const { d, calls } = db(null)
    const role = await resolveClarionRole(d, { sub: 'u1', org_id: 'o1', role: 'owner' } as never)
    expect(role).toBe('admin')
    expect(calls.some((s) => s.startsWith('INSERT'))).toBe(true)
  })
  it('returns null for a plain member with no row', async () => {
    const { d } = db(null)
    const role = await resolveClarionRole(d, { sub: 'u1', org_id: 'o1', role: 'member' } as never)
    expect(role).toBeNull()
  })
})
