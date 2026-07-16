import { describe, it, expect } from 'vitest'
import { getClarionRole } from '../server/db/members'

function fakeDb(row: unknown) {
  return { prepare: () => ({ bind: () => ({ first: async () => row }) }) } as unknown as D1Database
}

describe('getClarionRole', () => {
  it('returns the role when a row exists', async () => {
    const db = fakeDb({ clarion_role: 'supervisor' })
    expect(await getClarionRole(db, 'org_1', 'user_1')).toBe('supervisor')
  })
  it('returns null when no row exists', async () => {
    const db = fakeDb(null)
    expect(await getClarionRole(db, 'org_1', 'user_1')).toBeNull()
  })
})
