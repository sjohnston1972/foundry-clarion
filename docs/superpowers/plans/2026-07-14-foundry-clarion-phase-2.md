# Foundry Clarion — Phase 2 Implementation Plan (Agents, Skills & Realtime Spine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 0–1 auth spine into a telephony-ready spine: bind Workspace's D1 read-only, let an admin **enable a Workspace resource as a Clarion agent** (snapshotting skills), mint short-lived **Twilio Access Tokens** server-side, stand up the **per-org `ClarionRealtime` Durable Object** for presence, and register the browser softphone — **all locally / DRY_RUN, with no live Twilio account mutation and no live inbound calls.**

**Architecture:** Continue mirroring Workspace. A second read-only D1 binding (`WORKSPACE_DB` → `skills-foundry-db`) sources `resources` + skills; Clarion links to them **by lower(email)**, scoped to the caller's org via `departments.organization_id`, and **snapshots** the skills into its own `cc_skills`/`cc_agent_skills` so routing never depends on a live cross-DB read. Every Twilio side-effect that mutates the account (create TaskRouter Workspace, create Worker) is isolated behind a single `server/lib/twilio/provisioning.ts` module gated by a `TWILIO_DRY_RUN` flag that returns deterministic fake SIDs until Steven flips it off in-session. Access Tokens are **JWTs signed with `jose`** (Workers-native, no heavy SDK, no network). Realtime is **one Durable Object per org**, addressed by `idFromName(organization_id)`, with the presence-merge logic extracted as a pure, unit-tested function.

**Tech Stack:** TypeScript, Hono (`hono/cloudflare-pages`), `@foundry/auth` (vendored), `jose` (new — token signing), Cloudflare D1 (own + read-only Workspace bind), Cloudflare Durable Objects, React 19 + Vite 8, Twilio Voice JS SDK (`@twilio/voice-sdk`, frontend only), Vitest, oxlint, wrangler.

## Global Constraints

- **Package manager:** npm. Node 20+. **No `any`** — if TS fights you, ask before casting.
- **Feature branch only.** Suggested: `feat/clarion-phase-2-agents-realtime`. Never push to `main`. **No commits in `authpak/` or `skills-foundry/`** — read-only.
- **Envelopes:** success `{ success: true, data }`; errors `{ error: { code, message } }`. Never leak stack traces.
- **Route handler order:** input validation → auth check → business logic → response.
- **`organization_id` / `user_id` are TEXT.** No cross-database FKs. **Never write to `WORKSPACE_DB`** — it is bound read-only; only `SELECT`.
- **Every table gets a typed accessor** in `server/db/<table>.ts`; no raw SQL in route handlers.
- **Every query filters by `organization_id`.** Cross-tenant leak tests are mandatory for any new list endpoint.
- **No live Twilio account mutation in this plan.** `TWILIO_DRY_RUN` defaults to `"true"`; the real create-Workspace / create-Worker calls only run after Steven's explicit in-session "go" (see Preconditions). Access-token minting signs locally (no network) and needs only API-key **values**, which may be test dummies locally.
- **Secrets never reach the frontend.** The browser only ever receives a short-lived Access Token from `POST /api/token/voice`.
- **AuthPak contract (fixed):** cookie `fnd_session`; issuer `https://authpak.foundry-ns.com`; audience `foundry-ns`. Do not reinvent auth.
- Design tokens for any UI: canvas `#f6f7f9`, ink `#0f172a`, muted `#64748b`, hairline `#e6e8ec`, accent `#00a3ff`.

---

## Preconditions & external gates

These are **not** blockers for building/testing this plan (everything below is local + DRY_RUN), but each must be satisfied before the corresponding step goes *live*. Do not silently skip them; where a task touches one, the task says so.

| Gate | Needed for | State | Who |
|---|---|---|---|
| `../skills-foundry` clone accessible for its D1 id | `WORKSPACE_DB` remote binding (Task 2) | Local-verified via a synthetic fixture DB in tests; **real remote id deferred to deploy** | You confirm the sibling clone exists |
| `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` in `.dev.vars` | Real (usable) Access Tokens (Task 6) | **Not yet in `.env`.** Tests use dummy values; real values only needed to register against live Twilio | Steven provides |
| `TWILIO_TASKROUTER_WORKSPACE_SID` | Access-token TaskRouter grant + provisioning (Tasks 4, 6) | **Does not exist** — created by flipping DRY_RUN off (account mutation) | Steven's in-session "go" |
| `TWILIO_TWIML_APP_SID` | Voice grant (Task 6) | **Does not exist** — Twilio account mutation | Steven's in-session "go" |
| Flip `TWILIO_DRY_RUN` → `"false"` | Real Worker/Workspace creation (Task 4/5) | Stays `"true"` for the whole plan | Steven, at the Phase 2→3 boundary |

**STOP boundary of this plan:** finish Task 10 with `TWILIO_DRY_RUN="true"`. The first live account mutation (create the shared TaskRouter Workspace, create a real Worker, buy a number) belongs to the Phase 3 kickoff and requires Steven in the loop.

---

## File Structure

```
foundry-clarion/
  wrangler.jsonc                       # + WORKSPACE_DB binding, + durable_objects binding, + DO migration, + TWILIO_DRY_RUN var
  package.json                         # + jose (server), + @twilio/voice-sdk (frontend)
  .dev.vars                            # + TWILIO_* locals (gitignored)
  migrations/
    0002_agents.sql                    # cc_agents, cc_skills, cc_agent_skills
  functions/api/[[route]].ts           # + re-export ClarionRealtime so Pages bundles the DO class
  server/
    types.ts                           # + Twilio env, + WORKSPACE_DB, + REALTIME DO namespace
    app.ts                             # + mount /agents, /token, /realtime
    db/
      workspace.ts                     # READ-ONLY Workspace accessors (resources + skills by org/email)
      agents.ts                        # cc_agents accessor
      skills.ts                        # cc_skills + cc_agent_skills accessor (snapshot)
    lib/twilio/
      provisioning.ts                  # DRY_RUN-gated create-Workspace / create-Worker
      token.ts                         # jose-signed Twilio Access Token (Voice + TaskRouter grants)
    realtime/
      presence.ts                      # PURE presence-merge logic (unit-tested)
      clarion-realtime.ts              # ClarionRealtime Durable Object (WS hub, per org)
    routes/
      agents.ts                        # POST /agents/enable, GET /agents, GET /agents/candidates, POST /agents/status
      token.ts                         # POST /token/voice
      realtime.ts                      # GET /realtime/socket (WS upgrade -> org DO)
  src/
    lib/twilio-voice.ts                # frontend: fetch token, register Device, presence WS
    (agent panel wiring in App.tsx)
  test/
    agents-migration.test.ts, workspace-db.test.ts, agents-db.test.ts,
    provisioning.test.ts, agents-route.test.ts, token.test.ts,
    presence.test.ts, realtime-route.test.ts
```

---

## Task 1: Migration `0002_agents.sql` — cc_agents, cc_skills, cc_agent_skills

**Files:**
- Create: `migrations/0002_agents.sql`
- Test: `test/agents-migration.test.ts`

**Interfaces:**
- Produces tables `cc_agents` (UNIQUE `organization_id,email`), `cc_skills` (UNIQUE `organization_id,name`), `cc_agent_skills` (PK `agent_id,skill_id`). All ids TEXT (app-generated UUIDs).

- [ ] **Step 1: Write the failing test**

```ts
// test/agents-migration.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('0002_agents migration', () => {
  const sql = readFileSync('migrations/0002_agents.sql', 'utf8')
  it('declares the three Phase-2 tables', () => {
    for (const t of ['cc_agents', 'cc_skills', 'cc_agent_skills']) {
      expect(sql).toContain(`CREATE TABLE ${t}`)
    }
  })
  it('scopes agents + skills by org and links agent_skills to agents', () => {
    expect(sql).toContain('UNIQUE (organization_id, email)')
    expect(sql).toContain('UNIQUE (organization_id, name)')
    expect(sql).toContain('REFERENCES cc_agents(id)')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agents-migration.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Write `migrations/0002_agents.sql`**

```sql
-- 0002_agents.sql — Foundry Clarion agents, skill catalog, and the routing snapshot.
-- organization_id / user_id are AuthPak ids (TEXT). Workspace linkage is by EMAIL (no cross-DB FK).
-- All Clarion ids are app-generated UUIDs (TEXT).
PRAGMA foreign_keys = ON;

-- A member enabled as a live agent. Linked to a Workspace resource by email (snapshot).
CREATE TABLE cc_agents (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT NOT NULL,
  user_id               TEXT,                     -- AuthPak sub, if the agent is also a Clarion member; may be NULL
  email                 TEXT NOT NULL,
  workspace_resource_id TEXT,                     -- resources.id from WORKSPACE_DB (matched by lower(email))
  twilio_worker_sid     TEXT,                     -- WK...; DRY_RUN yields 'WKdryrun...'; NULL until provisioned
  status                TEXT NOT NULL DEFAULT 'offline'
                          CHECK (status IN ('offline','available','on-call','wrap-up')),
  activity_sid          TEXT,
  enabled_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (organization_id, email)
);
CREATE INDEX idx_cc_agents_org ON cc_agents(organization_id);

-- Clarion's own per-org skill catalog (names snapshotted from Workspace at enable-time).
CREATE TABLE cc_skills (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name            TEXT NOT NULL,
  UNIQUE (organization_id, name)
);
CREATE INDEX idx_cc_skills_org ON cc_skills(organization_id);

-- The routing snapshot: which agent has which skill, at what proficiency.
CREATE TABLE cc_agent_skills (
  agent_id    TEXT NOT NULL REFERENCES cc_agents(id) ON DELETE CASCADE,
  skill_id    TEXT NOT NULL REFERENCES cc_skills(id) ON DELETE CASCADE,
  proficiency INTEGER,                            -- Workspace level 0..5, snapshotted
  synced_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (agent_id, skill_id)
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agents-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply locally to catch SQL errors**

Run: `npm run d1:migrate:local`
Expected: `1 migration applied` (0002_agents).

- [ ] **Step 6: Commit**

```bash
git add migrations/0002_agents.sql test/agents-migration.test.ts
git commit -m "feat: 0002_agents — cc_agents, cc_skills, cc_agent_skills"
```

---

## Task 2: Twilio/DO env + read-only Workspace binding + Workspace accessors

**Files:**
- Modify: `server/types.ts`, `wrangler.jsonc`
- Create: `server/db/workspace.ts`, `.dev.vars` (add keys; gitignored)
- Test: `test/workspace-db.test.ts`

**Interfaces:**
- Consumes: Workspace tables `resources`, `departments`, `resource_sub_skills`, `sub_skills` (read-only, via `WORKSPACE_DB`).
- Produces:
  - `Bindings` extended with `WORKSPACE_DB: D1Database`, `REALTIME: DurableObjectNamespace`, and the Twilio env keys.
  - `type WorkspaceResource = { id: string; name: string; email: string; jobRole: string | null }`
  - `type WorkspaceSkill = { subSkillId: number; name: string; level: number | null }`
  - `listOrgResources(wdb, orgId): Promise<WorkspaceResource[]>` — all resources in the org (by `departments.organization_id`), email lowercased, email non-null.
  - `findOrgResourceByEmail(wdb, orgId, email): Promise<WorkspaceResource | null>`
  - `getResourceSkills(wdb, resourceId): Promise<WorkspaceSkill[]>`

- [ ] **Step 1: Write the failing test** (fake `WORKSPACE_DB` returning canned rows by SQL fragment)

```ts
// test/workspace-db.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/workspace-db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/db/workspace.ts`** (READ-ONLY; only SELECT)

```ts
// READ-ONLY accessors over the Workspace D1 (skills-foundry-db), bound as WORKSPACE_DB.
// NEVER write here. Org scoping is via departments.organization_id (Workspace migration 0008).
export type WorkspaceResource = { id: string; name: string; email: string; jobRole: string | null }
export type WorkspaceSkill = { subSkillId: number; name: string; level: number | null }

type ResourceRow = { id: string; name: string; email: string; job_role: string | null }

function toResource(r: ResourceRow): WorkspaceResource {
  return { id: r.id, name: r.name, email: r.email.toLowerCase(), jobRole: r.job_role }
}

export async function listOrgResources(wdb: D1Database, orgId: string): Promise<WorkspaceResource[]> {
  const { results } = await wdb
    .prepare(
      `SELECT r.id, r.name, r.email, r.job_role
         FROM resources r JOIN departments d ON r.department_id = d.id
        WHERE d.organization_id = ? AND r.email IS NOT NULL
        ORDER BY r.name`,
    )
    .bind(orgId)
    .all<ResourceRow>()
  return results.map(toResource)
}

export async function findOrgResourceByEmail(
  wdb: D1Database,
  orgId: string,
  email: string,
): Promise<WorkspaceResource | null> {
  const row = await wdb
    .prepare(
      `SELECT r.id, r.name, r.email, r.job_role
         FROM resources r JOIN departments d ON r.department_id = d.id
        WHERE d.organization_id = ? AND lower(r.email) = lower(?)
        LIMIT 1`,
    )
    .bind(orgId, email)
    .first<ResourceRow>()
  return row ? toResource(row) : null
}

export async function getResourceSkills(wdb: D1Database, resourceId: string): Promise<WorkspaceSkill[]> {
  const { results } = await wdb
    .prepare(
      `SELECT rss.sub_skill_id AS sub_skill_id, ss.name AS name, rss.level AS level
         FROM resource_sub_skills rss JOIN sub_skills ss ON rss.sub_skill_id = ss.id
        WHERE rss.resource_id = ?`,
    )
    .bind(resourceId)
    .all<{ sub_skill_id: number; name: string; level: number | null }>()
  return results.map((s) => ({ subSkillId: s.sub_skill_id, name: s.name, level: s.level }))
}
```

- [ ] **Step 4: Extend `server/types.ts`** — add the Twilio env, the Workspace binding, and the DO namespace to `Bindings`

```ts
import type { FoundryAuthVariables } from '@foundry/auth'

export type Bindings = {
  DB: D1Database
  /** Workspace's D1 (skills-foundry-db), bound READ-ONLY. */
  WORKSPACE_DB: D1Database
  /** Per-org realtime hub. */
  REALTIME: DurableObjectNamespace
  /** When 'true', a valid AuthPak session is REQUIRED (set at cutover). */
  AUTH_ENFORCE?: string
  /** When 'true' (default), Twilio account-mutating calls are stubbed with fake SIDs. */
  TWILIO_DRY_RUN?: string
  ADMIN_EMAILS?: string
  APP_BASE_URL?: string
  // --- Twilio (values provided later; token signing is local, no network) ---
  TWILIO_ACCOUNT_SID?: string
  TWILIO_AUTH_TOKEN?: string
  TWILIO_API_KEY_SID?: string
  TWILIO_API_KEY_SECRET?: string
  TWILIO_TASKROUTER_WORKSPACE_SID?: string
  TWILIO_TWIML_APP_SID?: string
}

export type Variables = Partial<FoundryAuthVariables> & {
  organizationId: string | null
  clarionRole: 'admin' | 'supervisor' | 'agent' | null
}

export type Env = { Bindings: Bindings; Variables: Variables }
```

- [ ] **Step 5: Extend `wrangler.jsonc`** — Workspace bind, DRY_RUN var, DO binding + migration (DO class arrives in Task 7; binding can be declared now)

```jsonc
{
  "name": "foundry-clarion",
  "compatibility_date": "2026-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "pages_build_output_dir": "dist",
  "vars": { "AUTH_ENFORCE": "false", "TWILIO_DRY_RUN": "true" },
  "d1_databases": [
    { "binding": "DB", "database_name": "foundry-clarion-db", "database_id": "REPLACE_AFTER_TASK_2", "migrations_dir": "migrations" },
    { "binding": "WORKSPACE_DB", "database_name": "skills-foundry-db", "database_id": "REPLACE_WITH_WORKSPACE_DB_ID" }
  ],
  "durable_objects": { "bindings": [ { "name": "REALTIME", "class_name": "ClarionRealtime" } ] },
  "migrations": [ { "tag": "v1", "new_sqlite_classes": ["ClarionRealtime"] } ]
}
```

> `REPLACE_WITH_WORKSPACE_DB_ID` is a **read** binding to an existing database Clarion does not own — get the id from `../skills-foundry/wrangler.jsonc` (or `wrangler d1 list`) at deploy time. For local tests it is irrelevant (tests inject a fake `WORKSPACE_DB`). Leave the placeholder until deploy; do not create a database.

- [ ] **Step 6: Add Twilio locals to `.dev.vars`** (gitignored — confirm `.gitignore` covers `.dev.vars`)

```
TWILIO_DRY_RUN=true
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=devplaceholder
TWILIO_API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_API_KEY_SECRET=devplaceholder
TWILIO_TASKROUTER_WORKSPACE_SID=WSxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_TWIML_APP_SID=APxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

> These are **dummy locals** so token minting has non-empty values to sign with. Real values come from Steven (Preconditions). Placeholders are fine for every test in this plan.

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run test/workspace-db.test.ts && npm run typecheck:server`
Expected: PASS + no type errors.

- [ ] **Step 8: Commit**

```bash
git add server/types.ts server/db/workspace.ts wrangler.jsonc test/workspace-db.test.ts
git commit -m "feat: read-only WORKSPACE_DB binding + resource/skill accessors + Twilio/DO env"
```

---

## Task 3: Clarion agent + skill snapshot accessors

**Files:**
- Create: `server/db/agents.ts`, `server/db/skills.ts`
- Test: `test/agents-db.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSkill` (Task 2).
- Produces:
  - `type Agent = { id: string; organizationId: string; userId: string | null; email: string; workspaceResourceId: string | null; twilioWorkerSid: string | null; status: string; activitySid: string | null }`
  - `insertAgent(db, a: { id; organizationId; userId; email; workspaceResourceId; twilioWorkerSid }): Promise<void>`
  - `getAgentByEmail(db, orgId, email): Promise<Agent | null>`
  - `listAgents(db, orgId): Promise<Agent[]>`
  - `setAgentStatus(db, orgId, agentId, status): Promise<void>`
  - `upsertSkill(db, orgId, name): Promise<string>` — returns the `cc_skills.id`, inserting if new.
  - `snapshotAgentSkills(db, orgId, agentId, skills: WorkspaceSkill[]): Promise<void>` — upserts each skill then the `cc_agent_skills` row (proficiency = level).

- [ ] **Step 1: Write the failing test**

```ts
// test/agents-db.test.ts
import { describe, it, expect } from 'vitest'
import { insertAgent, getAgentByEmail, listAgents } from '../server/db/agents'
import { upsertSkill } from '../server/db/skills'

// Minimal fake D1 backed by a plain array of "rows" per table keyed off SQL fragments.
function memDb() {
  const agents: Record<string, unknown>[] = []
  const skills: Record<string, unknown>[] = []
  const bindThen = (sql: string, args: unknown[]) => ({
    async run() {
      if (sql.startsWith('INSERT INTO cc_agents')) agents.push({ id: args[0], organization_id: args[1], user_id: args[2], email: args[3], workspace_resource_id: args[4], twilio_worker_sid: args[5], status: 'offline', activity_sid: null })
      if (sql.startsWith('INSERT INTO cc_skills')) skills.push({ id: args[0], organization_id: args[1], name: args[2] })
      return {}
    },
    async first() {
      if (sql.includes('FROM cc_agents') && sql.includes('email')) return agents.find((a) => a.organization_id === args[0] && a.email === args[1]) ?? null
      if (sql.includes('FROM cc_skills')) return skills.find((s) => s.organization_id === args[0] && s.name === args[1]) ?? null
      return null
    },
    async all() {
      if (sql.includes('FROM cc_agents')) return { results: agents.filter((a) => a.organization_id === args[0]) }
      return { results: [] }
    },
  })
  return { prepare: (sql: string) => ({ bind: (...args: unknown[]) => bindThen(sql, args) }) } as unknown as D1Database
}

describe('cc_agents accessors', () => {
  it('inserts and reads an agent back by email', async () => {
    const db = memDb()
    await insertAgent(db, { id: 'a1', organizationId: 'o1', userId: 'u1', email: 'ada@x.com', workspaceResourceId: 'r1', twilioWorkerSid: 'WKdryrun_a1' })
    const got = await getAgentByEmail(db, 'o1', 'ada@x.com')
    expect(got?.id).toBe('a1')
    expect(got?.twilioWorkerSid).toBe('WKdryrun_a1')
    expect((await listAgents(db, 'o1')).length).toBe(1)
  })
  it('does not leak another org\'s agents', async () => {
    const db = memDb()
    await insertAgent(db, { id: 'a1', organizationId: 'o1', userId: null, email: 'ada@x.com', workspaceResourceId: null, twilioWorkerSid: null })
    expect(await getAgentByEmail(db, 'o2', 'ada@x.com')).toBeNull()
    expect((await listAgents(db, 'o2')).length).toBe(0)
  })
})

describe('cc_skills upsert', () => {
  it('inserts a new skill and returns an id', async () => {
    const db = memDb()
    const id = await upsertSkill(db, 'o1', 'Billing')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agents-db.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `server/db/agents.ts`**

```ts
export type Agent = {
  id: string
  organizationId: string
  userId: string | null
  email: string
  workspaceResourceId: string | null
  twilioWorkerSid: string | null
  status: string
  activitySid: string | null
}

type AgentRow = {
  id: string; organization_id: string; user_id: string | null; email: string
  workspace_resource_id: string | null; twilio_worker_sid: string | null
  status: string; activity_sid: string | null
}

function toAgent(r: AgentRow): Agent {
  return {
    id: r.id, organizationId: r.organization_id, userId: r.user_id, email: r.email,
    workspaceResourceId: r.workspace_resource_id, twilioWorkerSid: r.twilio_worker_sid,
    status: r.status, activitySid: r.activity_sid,
  }
}

const COLS = 'id, organization_id, user_id, email, workspace_resource_id, twilio_worker_sid, status, activity_sid'

export async function insertAgent(
  db: D1Database,
  a: { id: string; organizationId: string; userId: string | null; email: string; workspaceResourceId: string | null; twilioWorkerSid: string | null },
): Promise<void> {
  await db
    .prepare(`INSERT INTO cc_agents (id, organization_id, user_id, email, workspace_resource_id, twilio_worker_sid) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(a.id, a.organizationId, a.userId, a.email.toLowerCase(), a.workspaceResourceId, a.twilioWorkerSid)
    .run()
}

export async function getAgentByEmail(db: D1Database, orgId: string, email: string): Promise<Agent | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_agents WHERE organization_id = ? AND email = ?`)
    .bind(orgId, email.toLowerCase())
    .first<AgentRow>()
  return row ? toAgent(row) : null
}

export async function listAgents(db: D1Database, orgId: string): Promise<Agent[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM cc_agents WHERE organization_id = ? ORDER BY email`)
    .bind(orgId)
    .all<AgentRow>()
  return results.map(toAgent)
}

export async function setAgentStatus(db: D1Database, orgId: string, agentId: string, status: string): Promise<void> {
  await db
    .prepare(`UPDATE cc_agents SET status = ? WHERE organization_id = ? AND id = ?`)
    .bind(status, orgId, agentId)
    .run()
}
```

- [ ] **Step 4: Write `server/db/skills.ts`**

```ts
import type { WorkspaceSkill } from './workspace'

export async function upsertSkill(db: D1Database, orgId: string, name: string): Promise<string> {
  const existing = await db
    .prepare(`SELECT id FROM cc_skills WHERE organization_id = ? AND name = ?`)
    .bind(orgId, name)
    .first<{ id: string }>()
  if (existing) return existing.id
  const id = crypto.randomUUID()
  await db
    .prepare(`INSERT INTO cc_skills (id, organization_id, name) VALUES (?, ?, ?)
              ON CONFLICT(organization_id, name) DO NOTHING`)
    .bind(id, orgId, name)
    .run()
  // Re-read in case a concurrent insert won the conflict.
  const row = await db
    .prepare(`SELECT id FROM cc_skills WHERE organization_id = ? AND name = ?`)
    .bind(orgId, name)
    .first<{ id: string }>()
  return row?.id ?? id
}

export async function snapshotAgentSkills(
  db: D1Database,
  orgId: string,
  agentId: string,
  skills: WorkspaceSkill[],
): Promise<void> {
  for (const s of skills) {
    const skillId = await upsertSkill(db, orgId, s.name)
    await db
      .prepare(`INSERT INTO cc_agent_skills (agent_id, skill_id, proficiency, synced_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(agent_id, skill_id) DO UPDATE SET proficiency = excluded.proficiency, synced_at = CURRENT_TIMESTAMP`)
      .bind(agentId, skillId, s.level)
      .run()
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/agents-db.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db/agents.ts server/db/skills.ts test/agents-db.test.ts
git commit -m "feat: typed accessors for cc_agents + cc_skills snapshot"
```

---

## Task 4: Twilio provisioning module (DRY_RUN-gated)

**Files:**
- Create: `server/lib/twilio/provisioning.ts`
- Test: `test/provisioning.test.ts`

**Interfaces:**
- Produces:
  - `isDryRun(env): boolean` — `env.TWILIO_DRY_RUN !== 'false'` (defaults to dry).
  - `createWorker(env, { orgId, friendlyName, attributes }): Promise<{ workerSid: string; dryRun: boolean }>` — in DRY_RUN returns `WKdryrun_<uuid>` with **no network call**; otherwise POSTs to TaskRouter and returns the real `sid`.
  - `ensureTaskRouterWorkspace(env): Promise<{ workspaceSid: string; dryRun: boolean }>` — DRY_RUN returns the configured (or fake) sid; real path requires `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN` and Steven's go.

- [ ] **Step 1: Write the failing test**

```ts
// test/provisioning.test.ts
import { describe, it, expect } from 'vitest'
import { isDryRun, createWorker } from '../server/lib/twilio/provisioning'

const baseEnv = {
  TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't',
  TWILIO_TASKROUTER_WORKSPACE_SID: 'WS1',
} as unknown as import('../server/types').Bindings

describe('provisioning DRY_RUN', () => {
  it('defaults to dry when the flag is unset', () => {
    expect(isDryRun({ ...baseEnv })).toBe(true)
  })
  it('createWorker returns a fake WK sid without hitting the network', async () => {
    const out = await createWorker({ ...baseEnv, TWILIO_DRY_RUN: 'true' }, { orgId: 'o1', friendlyName: 'ada@x.com', attributes: { organization_id: 'o1' } })
    expect(out.dryRun).toBe(true)
    expect(out.workerSid.startsWith('WKdryrun_')).toBe(true)
  })
  it('honours an explicit false flag (would go live) but errors without creds instead of silently faking', async () => {
    await expect(
      createWorker({ TWILIO_DRY_RUN: 'false' } as never, { orgId: 'o1', friendlyName: 'x', attributes: {} }),
    ).rejects.toThrow(/twilio credentials/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/provisioning.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/lib/twilio/provisioning.ts`**

```ts
import type { Bindings } from '../../types'

const TASKROUTER_BASE = 'https://taskrouter.twilio.com/v1'

export function isDryRun(env: Bindings): boolean {
  return env.TWILIO_DRY_RUN !== 'false'
}

function authHeader(env: Bindings): string {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    throw new Error('Missing Twilio credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
  }
  return 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`)
}

/** Create a TaskRouter Worker for an agent. DRY_RUN => deterministic fake SID, no network. */
export async function createWorker(
  env: Bindings,
  args: { orgId: string; friendlyName: string; attributes: Record<string, unknown> },
): Promise<{ workerSid: string; dryRun: boolean }> {
  if (isDryRun(env)) {
    return { workerSid: `WKdryrun_${crypto.randomUUID().replace(/-/g, '')}`, dryRun: true }
  }
  // LIVE PATH — only reached after Steven flips TWILIO_DRY_RUN=false in-session.
  const workspaceSid = env.TWILIO_TASKROUTER_WORKSPACE_SID
  if (!workspaceSid) throw new Error('Missing TWILIO_TASKROUTER_WORKSPACE_SID for live worker creation')
  const body = new URLSearchParams({
    FriendlyName: args.friendlyName,
    Attributes: JSON.stringify({ ...args.attributes, organization_id: args.orgId }),
  })
  const res = await fetch(`${TASKROUTER_BASE}/Workspaces/${workspaceSid}/Workers`, {
    method: 'POST',
    headers: { Authorization: authHeader(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`TaskRouter createWorker failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { sid: string }
  return { workerSid: json.sid, dryRun: false }
}

/** Ensure the single shared TaskRouter Workspace exists. DRY_RUN => returns configured/fake sid. */
export async function ensureTaskRouterWorkspace(env: Bindings): Promise<{ workspaceSid: string; dryRun: boolean }> {
  if (isDryRun(env)) {
    return { workspaceSid: env.TWILIO_TASKROUTER_WORKSPACE_SID ?? 'WSdryrun_shared', dryRun: true }
  }
  if (env.TWILIO_TASKROUTER_WORKSPACE_SID) return { workspaceSid: env.TWILIO_TASKROUTER_WORKSPACE_SID, dryRun: false }
  // LIVE creation is an account mutation — requires Steven's explicit go (Preconditions).
  const body = new URLSearchParams({ FriendlyName: 'Foundry Clarion (shared)', EventCallbackUrl: '' })
  const res = await fetch(`${TASKROUTER_BASE}/Workspaces`, {
    method: 'POST',
    headers: { Authorization: authHeader(env), 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error(`TaskRouter createWorkspace failed: ${res.status} ${await res.text()}`)
  const json = (await res.json()) as { sid: string }
  return { workspaceSid: json.sid, dryRun: false }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/provisioning.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add server/lib/twilio/provisioning.ts test/provisioning.test.ts
git commit -m "feat: DRY_RUN-gated Twilio provisioning (createWorker/ensureWorkspace)"
```

---

## Task 5: enable-as-agent + agent listing routes

**Files:**
- Create: `server/routes/agents.ts`
- Modify: `server/app.ts` (mount `/agents`)
- Test: `test/agents-route.test.ts`

**Interfaces:**
- Consumes: `requireClarionRole` (Phase 0–1 `server/lib/auth.ts`), `findOrgResourceByEmail`/`listOrgResources`/`getResourceSkills` (Task 2), `insertAgent`/`getAgentByEmail`/`listAgents`/`setAgentStatus` (Task 3), `snapshotAgentSkills` (Task 3), `createWorker` (Task 4).
- Produces:
  - `POST /api/agents/enable` (admin) — body `{ email: string }`; matches the Workspace resource, creates the Worker (DRY_RUN), inserts `cc_agents`, snapshots skills, writes `cc_audit_log`. Returns the new agent. 409 if already enabled; 404 if no matching Workspace resource.
  - `GET /api/agents` (supervisor+) — list enabled agents in the org.
  - `GET /api/agents/candidates` (admin) — Workspace resources in the org **not yet** enabled.
  - `POST /api/agents/status` (agent) — body `{ status }`; updates the caller's own agent row (found by the caller's email).

- [ ] **Step 1: Write the failing test** (mock `@foundry/auth` like Phase 0–1's `app-auth.test.ts`; inject fake `DB` + `WORKSPACE_DB`)

```ts
// test/agents-route.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) => {
    const c = req.headers.get('cookie') ?? ''
    if (c.includes('fnd_session=owner')) return { sub: 'u1', email: 'boss@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'owner', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
    return null
  }),
}))

import { createApp } from '../server/app'

// DB: records cc_agents inserts; cc_members returns admin for the owner bootstrap; skills upserts are no-ops.
function fakeDb() {
  const agents: Record<string, unknown>[] = []
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return null // -> owner bootstrap to admin
            if (sql.includes('FROM cc_agents') && sql.includes('email')) return agents.find((x) => x.email === a[1]) ?? null
            if (sql.includes('FROM cc_skills')) return null
            return null
          },
          async all() {
            if (sql.includes('FROM cc_agents')) return { results: agents }
            return { results: [] }
          },
          async run() {
            if (sql.startsWith('INSERT INTO cc_agents')) agents.push({ id: a[0], organization_id: a[1], email: a[3], twilio_worker_sid: a[5], status: 'offline', activity_sid: null, user_id: a[2], workspace_resource_id: a[4] })
            return {}
          },
        }),
      }
    },
  } as unknown as D1Database
}

// WORKSPACE_DB: one resource 'agent@acme.com' with one skill.
function fakeWorkspaceDb() {
  return {
    prepare(sql: string) {
      return {
        bind: () => ({
          async first() {
            if (sql.includes('lower(r.email) =')) return { id: 'r1', name: 'Agent A', email: 'agent@acme.com', job_role: 'Support' }
            return null
          },
          async all() {
            if (sql.includes('resource_sub_skills')) return { results: [{ sub_skill_id: 7, name: 'Billing', level: 4 }] }
            if (sql.includes('FROM resources')) return { results: [{ id: 'r1', name: 'Agent A', email: 'agent@acme.com', job_role: 'Support' }] }
            return { results: [] }
          },
        }),
      }
    },
  } as unknown as D1Database
}

const env = () => ({ DB: fakeDb(), WORKSPACE_DB: fakeWorkspaceDb(), AUTH_ENFORCE: 'true', TWILIO_DRY_RUN: 'true' })

describe('enable-as-agent', () => {
  it('403s a request with no session', async () => {
    const res = await createApp().request('/api/agents', { headers: { 'X-Requested-With': 'fetch' } }, env())
    expect(res.status).toBe(401)
  })
  it('enables a Workspace resource as an agent (DRY_RUN worker sid)', async () => {
    const app = createApp(); const e = env()
    const res = await app.request('/api/agents/enable', {
      method: 'POST', headers: { cookie: 'fnd_session=owner', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'agent@acme.com' }),
    }, e)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.data.email).toBe('agent@acme.com')
    expect(String(body.data.twilioWorkerSid)).toMatch(/^WKdryrun_/)
  })
  it('404s when no Workspace resource matches the email', async () => {
    const res = await createApp().request('/api/agents/enable', {
      method: 'POST', headers: { cookie: 'fnd_session=owner', 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@acme.com' }),
    }, env())
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agents-route.test.ts`
Expected: FAIL — `/api/agents*` routes not present.

- [ ] **Step 3: Write `server/routes/agents.ts`**

```ts
import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import { findOrgResourceByEmail, listOrgResources, getResourceSkills } from '../db/workspace'
import { insertAgent, getAgentByEmail, listAgents, setAgentStatus, type Agent } from '../db/agents'
import { snapshotAgentSkills } from '../db/skills'
import { createWorker } from '../lib/twilio/provisioning'

export const agents = new Hono<Env>()

// GET /api/agents — enabled agents in the org (supervisor+).
agents.get('/', requireClarionRole('supervisor'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  return c.json({ success: true, data: await listAgents(c.env.DB, orgId) })
})

// GET /api/agents/candidates — Workspace resources not yet enabled (admin).
agents.get('/candidates', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const [resources, enabled] = await Promise.all([
    listOrgResources(c.env.WORKSPACE_DB, orgId),
    listAgents(c.env.DB, orgId),
  ])
  const taken = new Set(enabled.map((a) => a.email))
  return c.json({ success: true, data: resources.filter((r) => !taken.has(r.email)) })
})

// POST /api/agents/enable — enable a Workspace resource as an agent (admin).
agents.post('/enable', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  let body: { email?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!email) return err(c, 'bad_input', 'email is required', 400)

  if (await getAgentByEmail(c.env.DB, orgId, email)) return err(c, 'already_enabled', 'Agent already enabled', 409)

  const resource = await findOrgResourceByEmail(c.env.WORKSPACE_DB, orgId, email)
  if (!resource) return err(c, 'no_resource', 'No Workspace resource with that email in this org', 404)

  const worker = await createWorker(c.env, {
    orgId, friendlyName: resource.email, attributes: { organization_id: orgId, email: resource.email },
  })

  const id = crypto.randomUUID()
  await insertAgent(c.env.DB, {
    id, organizationId: orgId, userId: null, email: resource.email,
    workspaceResourceId: resource.id, twilioWorkerSid: worker.workerSid,
  })
  const skills = await getResourceSkills(c.env.WORKSPACE_DB, resource.id)
  await snapshotAgentSkills(c.env.DB, orgId, id, skills)

  await c.env.DB
    .prepare(`INSERT INTO cc_audit_log (organization_id, user_id, action, meta_json) VALUES (?, ?, ?, ?)`)
    .bind(orgId, c.get('user')?.id ?? null, 'agent.enable', JSON.stringify({ agentId: id, email: resource.email, dryRun: worker.dryRun, skills: skills.length }))
    .run()

  const agent: Agent = {
    id, organizationId: orgId, userId: null, email: resource.email,
    workspaceResourceId: resource.id, twilioWorkerSid: worker.workerSid, status: 'offline', activitySid: null,
  }
  return c.json({ success: true, data: agent }, 201)
})

// POST /api/agents/status — the caller updates their own agent status (agent+).
agents.post('/status', requireClarionRole('agent'), async (c) => {
  const orgId = c.get('organizationId')
  const email = c.get('user')?.email
  if (!orgId || !email) return err(c, 'no_org', 'No organization in session', 400)
  let body: { status?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const allowed = ['offline', 'available', 'on-call', 'wrap-up']
  const status = typeof body.status === 'string' ? body.status : ''
  if (!allowed.includes(status)) return err(c, 'bad_input', `status must be one of ${allowed.join(', ')}`, 400)
  const agent = await getAgentByEmail(c.env.DB, orgId, email)
  if (!agent) return err(c, 'not_agent', 'Caller is not an enabled agent', 403)
  await setAgentStatus(c.env.DB, orgId, agent.id, status)
  return c.json({ success: true, data: { id: agent.id, status } })
})
```

- [ ] **Step 4: Mount the router in `server/app.ts`** — add the import and route **after** the enforce gate (so `organizationId`/`clarionRole` are set)

```ts
import { agents } from './routes/agents'
// ...after app.route('/me', me):
app.route('/agents', agents)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/agents-route.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck:server`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add server/routes/agents.ts server/app.ts test/agents-route.test.ts
git commit -m "feat: enable-as-agent + agent listing/candidates/status routes (DRY_RUN)"
```

---

## Task 6: Twilio Access Token minting

**Files:**
- Modify: `package.json` (add `jose`)
- Create: `server/lib/twilio/token.ts`, `server/routes/token.ts`
- Modify: `server/app.ts` (mount `/token`)
- Test: `test/token.test.ts`

**Interfaces:**
- Produces:
  - `mintVoiceToken(env, { identity, workerSid }): Promise<{ token: string; identity: string; expiresAt: number }>` — HS256 JWT signed with `TWILIO_API_KEY_SECRET`; header `cty: 'twilio-fpa;v=1'`; `iss` = API key SID, `sub` = account SID; grants = Voice (incoming allow, outgoing app sid) + TaskRouter (workspace + worker, role `worker`). Throws `twilio_not_configured` if any required env value is missing.
  - `POST /api/token/voice` (agent) — mints a token for the caller's own agent (identity = agent email, worker = the agent's `twilio_worker_sid`). 503 if Twilio unconfigured; 403 if caller is not an enabled agent.

- [ ] **Step 1: Add the dependency**

Run: `npm install jose@^5`
Expected: `jose` added to `dependencies`.

- [ ] **Step 2: Write the failing test** (sign with dummy creds, then verify + inspect grants with `jose`)

```ts
// test/token.test.ts
import { describe, it, expect } from 'vitest'
import { jwtVerify, decodeProtectedHeader } from 'jose'
import { mintVoiceToken } from '../server/lib/twilio/token'

const env = {
  TWILIO_ACCOUNT_SID: 'AC0000000000000000000000000000000',
  TWILIO_API_KEY_SID: 'SK0000000000000000000000000000000',
  TWILIO_API_KEY_SECRET: 'super-secret-key-value',
  TWILIO_TASKROUTER_WORKSPACE_SID: 'WS0000000000000000000000000000000',
  TWILIO_TWIML_APP_SID: 'AP0000000000000000000000000000000',
} as unknown as import('../server/types').Bindings

describe('mintVoiceToken', () => {
  it('signs a Twilio-shaped Access Token with Voice + TaskRouter grants', async () => {
    const { token, identity } = await mintVoiceToken(env, { identity: 'agent@acme.com', workerSid: 'WK123' })
    expect(identity).toBe('agent@acme.com')
    const header = decodeProtectedHeader(token)
    expect(header.cty).toBe('twilio-fpa;v=1')
    const { payload } = await jwtVerify(token, new TextEncoder().encode('super-secret-key-value'))
    expect(payload.iss).toBe('SK0000000000000000000000000000000')
    expect(payload.sub).toBe('AC0000000000000000000000000000000')
    const grants = payload.grants as Record<string, any>
    expect(grants.identity).toBe('agent@acme.com')
    expect(grants.voice.outgoing.application_sid).toBe('AP0000000000000000000000000000000')
    expect(grants.task_router.worker_sid).toBe('WK123')
    expect(grants.task_router.role).toBe('worker')
  })
  it('throws when Twilio is not configured', async () => {
    await expect(mintVoiceToken({} as never, { identity: 'x', workerSid: 'WK1' })).rejects.toThrow(/twilio_not_configured/)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/token.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Write `server/lib/twilio/token.ts`**

```ts
import { SignJWT } from 'jose'
import type { Bindings } from '../../types'

const TTL_SECONDS = 3600

export async function mintVoiceToken(
  env: Bindings,
  args: { identity: string; workerSid: string },
): Promise<{ token: string; identity: string; expiresAt: number }> {
  const { TWILIO_ACCOUNT_SID: acct, TWILIO_API_KEY_SID: keySid, TWILIO_API_KEY_SECRET: keySecret,
    TWILIO_TASKROUTER_WORKSPACE_SID: workspaceSid, TWILIO_TWIML_APP_SID: appSid } = env
  if (!acct || !keySid || !keySecret || !workspaceSid || !appSid) {
    throw new Error('twilio_not_configured')
  }
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + TTL_SECONDS
  const grants = {
    identity: args.identity,
    voice: { incoming: { allow: true }, outgoing: { application_sid: appSid } },
    task_router: { workspace_sid: workspaceSid, worker_sid: args.workerSid, role: 'worker' },
  }
  const token = await new SignJWT({ grants })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' })
    .setIssuer(keySid)
    .setSubject(acct)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(expiresAt)
    .setJti(`${keySid}-${now}`)
    .sign(new TextEncoder().encode(keySecret))
  return { token, identity: args.identity, expiresAt }
}
```

- [ ] **Step 5: Write `server/routes/token.ts`**

```ts
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
```

- [ ] **Step 6: Mount in `server/app.ts`**

```ts
import { token } from './routes/token'
// ...after app.route('/agents', agents):
app.route('/token', token)
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run test/token.test.ts && npm run typecheck:server`
Expected: PASS + no type errors.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json server/lib/twilio/token.ts server/routes/token.ts server/app.ts test/token.test.ts
git commit -m "feat: jose-signed Twilio Access Token + POST /api/token/voice"
```

---

## Task 7: Presence logic + `ClarionRealtime` Durable Object

**Files:**
- Create: `server/realtime/presence.ts`, `server/realtime/clarion-realtime.ts`
- Modify: `functions/api/[[route]].ts` (re-export the DO class so Pages bundles it)
- Test: `test/presence.test.ts`

**Interfaces:**
- Produces:
  - `type PresenceState = Record<string, { status: string; at: number }>` (keyed by agent identity/email).
  - `applyPresence(state, event): PresenceState` — pure reducer; `event = { identity, status, at }` (status `'offline'` removes the key).
  - `snapshotMessage(state): string` — JSON `{ type: 'presence', agents: [...] }` for fan-out.
  - `class ClarionRealtime` (Durable Object) — `fetch()` handles `GET .../socket` (WebSocket upgrade, hibernatable) and `POST .../presence` (server pushes a presence event, broadcast to sockets). One instance per org (addressed by `idFromName(orgId)`).

- [ ] **Step 1: Write the failing test** (pure reducer — the DO wiring is integration-verified in Task 10)

```ts
// test/presence.test.ts
import { describe, it, expect } from 'vitest'
import { applyPresence, snapshotMessage } from '../server/realtime/presence'

describe('applyPresence', () => {
  it('adds and updates an agent', () => {
    let s = applyPresence({}, { identity: 'ada@x.com', status: 'available', at: 1 })
    expect(s['ada@x.com'].status).toBe('available')
    s = applyPresence(s, { identity: 'ada@x.com', status: 'on-call', at: 2 })
    expect(s['ada@x.com'].status).toBe('on-call')
  })
  it('removes an agent on offline', () => {
    const s = applyPresence({ 'ada@x.com': { status: 'available', at: 1 } }, { identity: 'ada@x.com', status: 'offline', at: 2 })
    expect(s['ada@x.com']).toBeUndefined()
  })
  it('serialises a snapshot message', () => {
    const msg = JSON.parse(snapshotMessage({ 'ada@x.com': { status: 'available', at: 1 } }))
    expect(msg.type).toBe('presence')
    expect(msg.agents).toEqual([{ identity: 'ada@x.com', status: 'available', at: 1 }])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/presence.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/realtime/presence.ts`**

```ts
export type PresenceEvent = { identity: string; status: string; at: number }
export type PresenceState = Record<string, { status: string; at: number }>

/** Pure reducer. 'offline' removes the agent; anything else upserts it. */
export function applyPresence(state: PresenceState, e: PresenceEvent): PresenceState {
  const next: PresenceState = { ...state }
  if (e.status === 'offline') { delete next[e.identity]; return next }
  next[e.identity] = { status: e.status, at: e.at }
  return next
}

export function snapshotMessage(state: PresenceState): string {
  const agents = Object.entries(state).map(([identity, v]) => ({ identity, status: v.status, at: v.at }))
  return JSON.stringify({ type: 'presence', agents })
}
```

- [ ] **Step 4: Write `server/realtime/clarion-realtime.ts`** (hibernatable WebSocket DO; in-memory presence rebuilt from connected sockets + pushed events)

```ts
import { DurableObject } from 'cloudflare:workers'
import type { Bindings } from '../types'
import { applyPresence, snapshotMessage, type PresenceState, type PresenceEvent } from './presence'

/** One instance per org (addressed by idFromName(organization_id)). Realtime presence hub. */
export class ClarionRealtime extends DurableObject<Bindings> {
  private state: PresenceState = {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url)
    if (url.pathname.endsWith('/socket')) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      const pair = new WebSocketPair()
      const [client, server] = [pair[0], pair[1]]
      this.ctx.acceptWebSocket(server)
      server.send(snapshotMessage(this.state))
      return new Response(null, { status: 101, webSocket: client })
    }
    if (url.pathname.endsWith('/presence') && req.method === 'POST') {
      const e = (await req.json()) as PresenceEvent
      this.state = applyPresence(this.state, e)
      this.broadcast(snapshotMessage(this.state))
      return new Response('ok')
    }
    return new Response('not found', { status: 404 })
  }

  // Agent softphones may push their own presence over the socket.
  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return
    try {
      const e = JSON.parse(message) as PresenceEvent
      if (e && typeof e.identity === 'string' && typeof e.status === 'string') {
        this.state = applyPresence(this.state, { identity: e.identity, status: e.status, at: e.at ?? Date.now() })
        this.broadcast(snapshotMessage(this.state))
      }
    } catch { /* ignore malformed frames */ }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    try { ws.close() } catch { /* already closed */ }
  }

  private broadcast(msg: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(msg) } catch { /* drop dead socket */ }
    }
  }
}
```

- [ ] **Step 5: Re-export the DO from the Pages Functions entry** so the class is bundled (Pages requirement). Edit `functions/api/[[route]].ts`:

```ts
import { handle } from 'hono/cloudflare-pages'
import { createApp } from '../../server/app'

export const onRequest = handle(createApp())

// Durable Object classes referenced in wrangler.jsonc must be exported from the Functions bundle.
export { ClarionRealtime } from '../../server/realtime/clarion-realtime'
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/presence.test.ts && npm run typecheck:server`
Expected: PASS + no type errors. (If TS can't find `cloudflare:workers`, ensure `@cloudflare/workers-types` is in `tsconfig.server.json`'s `types` — it already is from Phase 0.)

- [ ] **Step 7: Commit**

```bash
git add server/realtime functions/api/[[route]].ts test/presence.test.ts
git commit -m "feat: ClarionRealtime Durable Object + pure presence reducer"
```

---

## Task 8: Realtime WS route + status → DO push

**Files:**
- Create: `server/routes/realtime.ts`
- Modify: `server/app.ts` (mount `/realtime`), `server/routes/agents.ts` (push status change to the org DO)
- Test: `test/realtime-route.test.ts`

**Interfaces:**
- Consumes: `c.env.REALTIME` (DO namespace), `requireClarionRole` .
- Produces:
  - `GET /api/realtime/socket` (agent+) — resolves the caller's org DO (`idFromName(orgId)`) and forwards the upgrade request to it; returns the 101 response.
  - `pushPresence(env, orgId, event)` helper — POSTs a presence event to the org DO (used by `POST /api/agents/status`).

- [ ] **Step 1: Write the failing test** (fake `REALTIME` namespace records the forwarded request; assert the WS route reaches the DO stub and `/status` pushes a presence event)

```ts
// test/realtime-route.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) =>
    (req.headers.get('cookie') ?? '').includes('fnd_session=agent')
      ? { sub: 'u9', email: 'agent@acme.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'member', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
      : null),
}))

import { createApp } from '../server/app'

function fakeRealtime(seen: Request[]) {
  const stub = { fetch: async (r: Request) => { seen.push(r); return new Response(null, { status: 101 }) } }
  return { idFromName: (_n: string) => ({ toString: () => 'id' }), get: (_id: unknown) => stub } as unknown as DurableObjectNamespace
}

// cc_members returns 'agent' for this user; cc_agents has the caller.
function fakeDb() {
  return {
    prepare(sql: string) {
      return { bind: (..._a: unknown[]) => ({
        async first() {
          if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
          if (sql.includes('FROM cc_members')) return { clarion_role: 'agent' }
          if (sql.includes('FROM cc_agents')) return { id: 'a1', organization_id: 'o1', email: 'agent@acme.com', twilio_worker_sid: 'WKdryrun_1', status: 'offline', activity_sid: null, user_id: 'u9', workspace_resource_id: 'r1' }
          return null
        },
        async run() { return {} }, async all() { return { results: [] } },
      }) }
    },
  } as unknown as D1Database
}

describe('realtime + status push', () => {
  it('forwards a WS upgrade to the org DO', async () => {
    const seen: Request[] = []
    const res = await createApp().request('/api/realtime/socket', { headers: { cookie: 'fnd_session=agent', Upgrade: 'websocket' } }, { DB: fakeDb(), REALTIME: fakeRealtime(seen), AUTH_ENFORCE: 'true' })
    expect(res.status).toBe(101)
    expect(seen.length).toBe(1)
  })
  it('status change pushes a presence event to the DO', async () => {
    const seen: Request[] = []
    const res = await createApp().request('/api/agents/status', {
      method: 'POST', headers: { cookie: 'fnd_session=agent', 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'available' }),
    }, { DB: fakeDb(), REALTIME: fakeRealtime(seen), AUTH_ENFORCE: 'true' })
    expect(res.status).toBe(200)
    expect(seen.some((r) => r.url.endsWith('/presence'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/realtime-route.test.ts`
Expected: FAIL — `/realtime/socket` not present; `/status` does not push.

- [ ] **Step 3: Write `server/routes/realtime.ts`**

```ts
import { Hono } from 'hono'
import type { Env } from '../types'
import type { Bindings } from '../types'
import { err } from '../lib/http'
import { requireClarionRole } from '../lib/auth'
import type { PresenceEvent } from '../realtime/presence'

// Address the caller's org DO and forward a request to it.
function orgStub(env: Bindings, orgId: string) {
  const id = env.REALTIME.idFromName(orgId)
  return env.REALTIME.get(id)
}

export async function pushPresence(env: Bindings, orgId: string, event: PresenceEvent): Promise<void> {
  await orgStub(env, orgId).fetch('https://do/presence', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(event),
  })
}

export const realtime = new Hono<Env>()

// GET /api/realtime/socket — upgrade to the org's realtime hub (agent+).
realtime.get('/socket', requireClarionRole('agent'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  if (c.req.header('Upgrade') !== 'websocket') return err(c, 'expected_ws', 'Expected a WebSocket upgrade', 426)
  return orgStub(c.env, orgId).fetch(new Request('https://do/socket', c.req.raw))
})
```

- [ ] **Step 4: Push presence from `POST /api/agents/status`** — edit `server/routes/agents.ts`, import the helper and call it after `setAgentStatus`

```ts
// add to imports at top of server/routes/agents.ts:
import { pushPresence } from './realtime'

// inside agents.post('/status', ...), replace the final return with:
  await setAgentStatus(c.env.DB, orgId, agent.id, status)
  await pushPresence(c.env, orgId, { identity: agent.email, status, at: Date.now() })
  return c.json({ success: true, data: { id: agent.id, status } })
```

- [ ] **Step 5: Mount in `server/app.ts`**

```ts
import { realtime } from './routes/realtime'
// ...after app.route('/token', token):
app.route('/realtime', realtime)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/realtime-route.test.ts && npm run typecheck:server`
Expected: PASS + no type errors.

- [ ] **Step 7: Commit**

```bash
git add server/routes/realtime.ts server/routes/agents.ts server/app.ts test/realtime-route.test.ts
git commit -m "feat: realtime WS route (org DO) + status -> presence push"
```

---

## Task 9: Frontend softphone registration + presence (build-verified UI)

**Files:**
- Modify: `package.json` (add `@twilio/voice-sdk`)
- Create: `src/lib/twilio-voice.ts`
- Modify: `src/App.tsx` (agent panel: register button + presence list)

**Interfaces:**
- Consumes: `POST /api/token/voice`, `GET /api/realtime/socket`, `POST /api/agents/status`.
- Produces:
  - `fetchVoiceToken(): Promise<{ token: string; identity: string; expiresAt: number }>`
  - `registerDevice(token): Promise<Device>` — constructs a `@twilio/voice-sdk` `Device`, registers it, returns it. (Wrapped so it no-ops gracefully when Twilio is unconfigured → the token endpoint returns 503.)
  - `openPresenceSocket(onSnapshot): WebSocket` — opens `/api/realtime/socket`, calls `onSnapshot(agents)` on each message.

> This task is **build/lint-verified**, not unit-tested end-to-end: live registration needs a real `fnd_session` cookie **and** real Twilio creds, both deferred (Preconditions). Keep the panel minimal — a full agent console is Phase 3+.

- [ ] **Step 1: Add the frontend SDK**

Run: `npm install @twilio/voice-sdk`
Expected: added to `dependencies`.

- [ ] **Step 2: Write `src/lib/twilio-voice.ts`**

```ts
import { Device } from '@twilio/voice-sdk'

export type VoiceToken = { token: string; identity: string; expiresAt: number }

export async function fetchVoiceToken(): Promise<VoiceToken> {
  const res = await fetch('/api/token/voice', { method: 'POST', credentials: 'include' })
  if (!res.ok) throw new Error(`token ${res.status}`)
  return (await res.json()).data as VoiceToken
}

export async function registerDevice(token: string): Promise<Device> {
  const device = new Device(token, { logLevel: 'error' })
  await device.register()
  return device
}

export type PresenceAgent = { identity: string; status: string; at: number }

export function openPresenceSocket(onSnapshot: (agents: PresenceAgent[]) => void): WebSocket {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const ws = new WebSocket(`${proto}//${location.host}/api/realtime/socket`)
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data as string)
      if (msg.type === 'presence') onSnapshot(msg.agents as PresenceAgent[])
    } catch { /* ignore */ }
  }
  return ws
}
```

- [ ] **Step 3: Add a minimal agent panel to `src/App.tsx`** — in the `app` gate state, render a "Softphone" card: a **Register** button (calls `fetchVoiceToken` → `registerDevice`, shows `registered` / `unavailable (Twilio not configured)` on 503), a status selector that `POST`s `/api/agents/status`, and a live presence list fed by `openPresenceSocket`. Use the design tokens; keep it under ~120 lines. Guard all Twilio calls in `try/catch` so a 503 renders a friendly "Telephony not yet configured" state rather than crashing.

- [ ] **Step 4: Build + lint to confirm it compiles**

Run: `npm run build && npm run lint`
Expected: `vite build` succeeds, `dist/` produced; oxlint clean.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/lib/twilio-voice.ts src/App.tsx
git commit -m "feat: frontend softphone registration + presence panel (Twilio-optional)"
```

---

## Task 10: Green capstone — status doc, full local gate, STOP boundary

**Files:**
- Create: `docs/phase-2-status.md`

- [ ] **Step 1: Apply migrations locally**

Run: `npm run d1:migrate:local`
Expected: `0002_agents` applied (or "no migrations to apply" if already applied).

- [ ] **Step 2: Full local gate**

Run: `npx vitest run && npm run typecheck:server && npm run lint && npm run build`
Expected: all green (all 8 new test files pass; typecheck clean; oxlint clean; `dist/` built).

- [ ] **Step 3: Integration-verify the DO + routes with `wrangler pages dev`**

Run: `npm run pages:dev` (one shell), then in another:
```bash
curl -s http://localhost:8788/api/health           # {"success":true,...,"database":"connected"}
curl -s http://localhost:8788/api/auth-status       # {"success":true,"data":{"authenticated":false,...}}
```
Expected: health + auth-status green. (Authenticated agent/token/WS flows need a real `fnd_session` cookie + Twilio creds — deferred; note as a Phase-3 follow-up, not a Phase-2 blocker.) If `wrangler pages dev` cannot bind `WORKSPACE_DB` locally, run with a local D1 alias or `--d1 WORKSPACE_DB=...`; document whichever you used.

- [ ] **Step 4: Write `docs/phase-2-status.md`** summarizing what Phase 2 delivers and the STOP boundary

```markdown
# Foundry Clarion — Phase 2 status

**Delivered (local + DRY_RUN, no live Twilio):**
- `0002_agents` migration: `cc_agents`, `cc_skills`, `cc_agent_skills`.
- Read-only `WORKSPACE_DB` binding + accessors (resources/skills by org + email).
- enable-as-agent flow: match Workspace resource by email → DRY_RUN Twilio Worker → `cc_agents` → skill snapshot → audit.
- Agent listing / candidates / self-status routes (org-scoped, role-guarded).
- jose-signed Twilio Access Token minting + `POST /api/token/voice`.
- `ClarionRealtime` per-org Durable Object + presence reducer + WS route + status→DO push.
- Frontend softphone registration + presence panel (degrades to "not configured" without Twilio creds).

**Verified:** full local gate (vitest + typecheck + lint + build) green; DO/routes exercised via `wrangler pages dev` for the public endpoints.

## STOP boundary — Phase 3 needs live Twilio
Everything above runs with `TWILIO_DRY_RUN="true"`. Going live requires Steven in-session:
- Add real `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` (+ TwiML App SID) to secrets.
- Create the **shared TaskRouter Workspace** (`ensureTaskRouterWorkspace`, account mutation) and set `TWILIO_TASKROUTER_WORKSPACE_SID`.
- Flip `TWILIO_DRY_RUN="false"` so `createWorker` provisions real Workers.
- Fill `WORKSPACE_DB` `database_id` from skills-foundry and deploy.
Phase 3 (queues, inbound TwiML, live routing → DO) starts here.
```

- [ ] **Step 5: Commit**

```bash
git add docs/phase-2-status.md
git commit -m "docs: Phase 2 complete (agents + token + realtime spine, DRY_RUN-verified)"
```

- [ ] **Step 6: Finish the branch** per `superpowers:finishing-a-development-branch` (open a PR; do **not** merge to `main` directly).

---

## Self-Review

**Spec coverage (design §9 Phase 2 + §6):**
- `WORKSPACE_DB` read-only binding → Task 2. ✅
- enable-as-agent (pick resource by email, snapshot skills into `cc_agent_skills`) → Tasks 2–3, 5. ✅
- `cc_agents` / `cc_skills` / `cc_agent_skills` → Task 1. ✅
- Mints Twilio Access Tokens (server-side, secrets never in frontend) → Task 6. ✅
- Per-org Durable Object (`ClarionRealtime`) for presence → Tasks 7–8. ✅
- Browser softphone registers, no live inbound → Task 9 (registration only; inbound is Phase 3). ✅
- Twilio account mutation gated (§6.7 provisioning module + DRY_RUN) → Task 4, honoured throughout. ✅
- Isolation: every new list/query filtered by `organization_id`; cross-tenant leak assertion in Task 3; per-org DO by construction. ✅

**Placeholder scan:** the only prose-not-code steps are the two genuinely UI/human-in-loop ones — Task 9 Step 3 (agent panel; live registration can't be unit-tested without real creds + cookie) and Task 10 Step 3 (integration probe). Every server/data/token/DO logic step carries full code. No `TODO`/`add error handling` placeholders in code steps.

**Type consistency:** `WorkspaceResource`/`WorkspaceSkill` (Task 2) are consumed unchanged in Tasks 3, 5. `Agent` (Task 3) returned by `getAgentByEmail`/`listAgents` and used in Tasks 5, 6. `PresenceEvent`/`PresenceState` (Task 7) used by the DO and `pushPresence` (Task 8). `createWorker(env, {orgId, friendlyName, attributes})` and `mintVoiceToken(env, {identity, workerSid})` signatures are identical at definition and call sites. `Bindings` gains `WORKSPACE_DB`, `REALTIME`, and the Twilio keys in Task 2 before any consumer uses them. ✅

**Known integration risks (flagged, not blockers):**
- **Pages + Durable Objects bundling:** the DO class must be exported from the Functions entry (Task 7 Step 5). If `wrangler pages dev` reports the class isn't found, confirm the export path and that `new_sqlite_classes` matches the class name exactly.
- **`WORKSPACE_DB` local binding:** local `wrangler pages dev` may need an explicit local D1 for the second binding (Task 10 Step 3).
- **`sub_skills` column names:** the skill snapshot query assumes `sub_skills(id, name)`; confirm against the live `skills-foundry` schema when the remote bind is wired (tests use a fixture).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-07-14-foundry-clarion-phase-2.md`.** It covers design §9 Phase 2 (agents, skills, Twilio tokens, realtime spine) to test-first, executable detail, entirely local + DRY_RUN, stopping before the first live Twilio account mutation.

Two execution options:
1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints.

**Autonomous-run note:** to run this the way Phase 0–1 ran (overnight, resumable), it also needs the root `PLAN.md` / `PROGRESS.md` handoff pair regenerated for Phase 2 and the existing `DONE` marker removed — say the word and I'll generate that companion pair (I won't touch the state files without your go).
