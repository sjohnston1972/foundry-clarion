import { describe, it, expect } from 'vitest'
import { listOrgResources, findOrgResourceByEmail, getResourceSkills } from '../server/db/workspace'

function wdb(rows: Record<string, unknown[]>) {
  return {
    prepare(sql: string) {
      const key = sql.includes('resource_sub_skills') ? 'skills'
        : sql.includes('lower(r.email) =') ? 'one' : 'list'
      return {
        bind: () => ({
          all: async () => ({ results: rows[key] ?? [] }),
          first: async () => (rows[key] ?? [])[0] ?? null,
        }),
      }
    },
  } as unknown as D1Database
}

describe('workspace read-only accessors', () => {
  it('lists org resources with lowercased email', async () => {
    const db = wdb({ list: [{ id: 'r1', name: 'Ada', email: 'ada@x.com', job_role: 'Eng' }] })
    const out = await listOrgResources(db, 'org_1')
    expect(out).toEqual([{ id: 'r1', name: 'Ada', email: 'ada@x.com', jobRole: 'Eng' }])
  })
  it('finds one resource by email', async () => {
    const db = wdb({ one: [{ id: 'r1', name: 'Ada', email: 'ada@x.com', job_role: null }] })
    const out = await findOrgResourceByEmail(db, 'org_1', 'ADA@x.com')
    expect(out?.id).toBe('r1')
    expect(out?.jobRole).toBeNull()
  })
  it('returns [] when no resource matches', async () => {
    const db = wdb({})
    expect(await findOrgResourceByEmail(db, 'org_1', 'nobody@x.com')).toBeNull()
  })
  it('maps resource skills', async () => {
    const db = wdb({ skills: [{ sub_skill_id: 7, name: 'Billing', level: 4 }] })
    expect(await getResourceSkills(db, 'r1')).toEqual([{ subSkillId: 7, name: 'Billing', level: 4 }])
  })
})
