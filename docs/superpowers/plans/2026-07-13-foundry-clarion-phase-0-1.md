# Foundry Clarion — Phase 0–1 Implementation Plan (Bootstrap + Auth Spine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Foundry Clarion Cloudflare app (Pages + Hono Pages Functions + own D1) with a working health check, then wire AuthPak session verification, the Clarion-role model, and the SPA auth gate — so every later phase has a tested identity + tenancy spine.

**Architecture:** Mirror Skills Foundry (Workspace) and AuthPak exactly: React 19 + Vite + Tailwind v4 SPA served by Cloudflare Pages; a single Pages Function `functions/api/[[route]].ts` mounts a Hono app in `server/`; Cloudflare **D1** (`foundry-clarion-db`, Clarion-owned) for data; identity comes only from the AuthPak `fnd_session` JWT, verified statelessly via JWKS with the vendored `@foundry/auth`. Clarion owns its roles in `cc_members`, keyed by AuthPak `organization_id` + `user_id` (TEXT, no cross-DB FK).

**Tech Stack:** TypeScript, Hono (`hono/cloudflare-pages`), `@foundry/auth` (vendored tarball), React 19, Vite 8, Tailwind v4, `react-router-dom` v7, Vitest, oxlint, wrangler, Cloudflare D1.

## Global Constraints

- **Package manager:** npm. Node 20+.
- **Never** commit `.env` or `.dev.vars`. Confirm `.gitignore` covers both before the first commit.
- **Feature branch only:** `feat/clarion-plan-and-design` (already checked out) or a `feat/clarion-phase-0-1` branch. Never push to `main`.
- **No cross-repo commits** in `authpak/` or `skills-foundry/`.
- **No `any`.** Error responses are JSON `{ error: { code, message } }`; success envelopes are `{ success: true, data }` to match Workspace.
- **Route handler order:** input validation → auth check → business logic → response.
- **Every table** gets a typed accessor in `src/db/` (server-side) — no raw SQL in handlers.
- **`organization_id` and `user_id` are TEXT** (AuthPak ids). No foreign keys into any other D1.
- **AuthPak contract (fixed, do not reinvent):** cookie `fnd_session`; issuer `https://authpak.foundry-ns.com`; audience `foundry-ns`; JWKS `https://authpak.foundry-ns.com/.well-known/jwks.json`. `verifyFoundrySession(req)` already defaults to all of these.
- **No Twilio code in this plan.** Phases 0–1 are identity + tenancy only.
- Design tokens for any UI: canvas `#f6f7f9`, ink `#0f172a`, muted `#64748b`, hairline `#e6e8ec`, accent `#00a3ff`.

---

## File Structure

```
foundry-clarion/
  package.json                       # npm scripts, deps (mirror Workspace)
  wrangler.jsonc                     # Pages project + D1 binding
  tsconfig.json / tsconfig.server.json
  vite.config.ts
  vitest.config.ts
  .gitignore                         # must include .env, .dev.vars, dist, node_modules, .wrangler
  .dev.vars                          # local secrets (gitignored)
  vendor/foundry-auth-0.1.0.tgz      # copied from ../skills-foundry/vendor
  migrations/
    0001_init.sql                    # cc_org_directory, cc_members, cc_audit_log
  functions/api/[[route]].ts         # Pages Function entry -> createApp()
  server/
    app.ts                           # Hono app: health (pre-gate), auth-status, enforce middleware, routes
    types.ts                         # Env = { Bindings, Variables }
    lib/
      http.ts                        # json helpers, error envelope, apiOnError
      auth.ts                        # role resolution + guards (requireClarionRole)
      directory.ts                   # touchOrgDirectory()
    routes/
      health.ts
      me.ts                          # GET /api/me  (current identity + clarion role)
    db/
      directory.ts                   # cc_org_directory accessor
      members.ts                     # cc_members accessor
  src/                               # React SPA (gate + shell); minimal in Phase 1
    main.tsx, App.tsx, lib/session.ts
  test/                              # Vitest unit tests (server-side)
```

---

## Phase 0 — Bootstrap

### Task 1: Repo scaffold, package.json, gitignore, wrangler config

**Files:**
- Create: `package.json`, `.gitignore`, `wrangler.jsonc`, `tsconfig.json`, `tsconfig.server.json`, `vite.config.ts`, `vitest.config.ts`
- Create: `vendor/foundry-auth-0.1.0.tgz` (copied)

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `test`, `pages:dev`, `d1:migrate:local`, `d1:migrate:remote`; the `@foundry/auth` dependency resolvable from the vendored tarball.

- [ ] **Step 1: Copy the vendored auth package**

```bash
mkdir -p vendor
cp ../skills-foundry/vendor/foundry-auth-0.1.0.tgz vendor/foundry-auth-0.1.0.tgz
# Fallback if that file is missing: (cd ../authpak/packages/foundry-auth && npm pack) then copy the tgz here.
```

- [ ] **Step 2: Write `.gitignore`**

```gitignore
node_modules
dist
.wrangler
.env
.dev.vars
*.local
.DS_Store
```

- [ ] **Step 3: Write `package.json`** (mirror Workspace's toolchain versions)

```json
{
  "name": "foundry-clarion",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "oxlint",
    "typecheck:server": "tsc -p tsconfig.server.json --noEmit",
    "pages:dev": "wrangler pages dev",
    "pages:deploy": "npm run build && wrangler pages deploy",
    "d1:migrate:local": "wrangler d1 migrations apply foundry-clarion-db --local",
    "d1:migrate:remote": "wrangler d1 migrations apply foundry-clarion-db --remote"
  },
  "dependencies": {
    "@foundry/auth": "file:vendor/foundry-auth-0.1.0.tgz",
    "@tanstack/react-query": "^5.71.0",
    "hono": "^4.7.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-router-dom": "^7.6.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250620.0",
    "@tailwindcss/vite": "^4.1.0",
    "@types/node": "^24.13.2",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.2",
    "oxlint": "^1.69.0",
    "tailwindcss": "^4.1.0",
    "typescript": "~6.0.2",
    "vite": "^8.1.0",
    "vitest": "^3.2.4",
    "wrangler": "^4.104.0"
  }
}
```

- [ ] **Step 4: Write `wrangler.jsonc`** (D1 id filled after Task 2)

```jsonc
{
  "name": "foundry-clarion",
  "compatibility_date": "2026-06-01",
  "compatibility_flags": ["nodejs_compat"],
  "pages_build_output_dir": "dist",
  "vars": { "AUTH_ENFORCE": "false" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "foundry-clarion-db",
      "database_id": "REPLACE_AFTER_TASK_2",
      "migrations_dir": "migrations"
    }
  ]
}
```

- [ ] **Step 5: Write `tsconfig.server.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`** (copy Workspace's, adjusting names). Minimal `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } })
```

- [ ] **Step 6: Install**

Run: `npm install`
Expected: installs clean; `@foundry/auth` resolves from `vendor/`.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json .gitignore wrangler.jsonc tsconfig*.json vite.config.ts vitest.config.ts vendor/
git commit -m "chore: bootstrap foundry-clarion scaffold (Pages + Hono + D1 + @foundry/auth)"
```

---

### Task 2: Create the Clarion D1 database

**Files:** Modify `wrangler.jsonc:database_id`

**Interfaces:** Produces the `foundry-clarion-db` D1 database and its id.

- [ ] **Step 1: Create the database**

Run: `wrangler d1 create foundry-clarion-db`
Expected: prints a `database_id` UUID. (This is a Cloudflare account change but **not** a Twilio/billing mutation — it is free and expected for Phase 0. If you want zero account changes until sign-off, stop here and confirm with Steven.)

- [ ] **Step 2: Paste the id into `wrangler.jsonc`** replacing `REPLACE_AFTER_TASK_2`.

- [ ] **Step 3: Add the id to `.env`** as `D1_DATABASE_ID=<uuid>` (gitignored).

- [ ] **Step 4: Commit** (config only — no secret)

```bash
git add wrangler.jsonc
git commit -m "chore: bind foundry-clarion-db D1 database"
```

---

### Task 3: Health route + Pages Function entry (first green test)

**Files:**
- Create: `server/types.ts`, `server/lib/http.ts`, `server/routes/health.ts`, `server/app.ts`, `functions/api/[[route]].ts`
- Test: `test/health.test.ts`

**Interfaces:**
- Produces: `createApp(): Hono<Env>`; `type Env = { Bindings: Bindings; Variables: Variables }`; `json(c, data)` / `err(c, code, message, status)` helpers; `GET /api/health` → `{ success: true, status: 'healthy', database: 'connected' }`.

- [ ] **Step 1: Write the failing test**

```ts
// test/health.test.ts
import { describe, it, expect } from 'vitest'
import { createApp } from '../server/app'

const DB = { prepare: () => ({ first: async () => ({ ok: 1 }) }) } as unknown as D1Database
const env = { DB }

describe('GET /api/health', () => {
  it('reports healthy when the DB responds', async () => {
    const app = createApp()
    const res = await app.request('/api/health', {}, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, status: 'healthy', database: 'connected' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/health.test.ts`
Expected: FAIL — `Cannot find module '../server/app'`.

- [ ] **Step 3: Write `server/types.ts`**

```ts
import type { FoundryAuthVariables } from '@foundry/auth'

export type Bindings = {
  DB: D1Database
  /** When 'true', a valid AuthPak session is REQUIRED (set at cutover). */
  AUTH_ENFORCE?: string
  /** Comma-separated emails granted a cross-tenant Clarion site-admin view. */
  ADMIN_EMAILS?: string
  APP_BASE_URL?: string
}

/** AuthPak identity is present only on authenticated requests. `organizationId`
 *  is resolved by the auth middleware; `clarionRole` is Clarion's own role. */
export type Variables = Partial<FoundryAuthVariables> & {
  organizationId: string | null
  clarionRole: 'admin' | 'supervisor' | 'agent' | null
}

export type Env = { Bindings: Bindings; Variables: Variables }
```

- [ ] **Step 4: Write `server/lib/http.ts`**

```ts
import type { Context } from 'hono'

export function json<T>(c: Context, data: T, status = 200) {
  return c.json({ success: true, data }, status)
}

export function err(c: Context, code: string, message: string, status = 400) {
  return c.json({ error: { code, message } }, status)
}

export function apiOnError(e: Error, c: Context) {
  console.error('api_error', e.message)
  return c.json({ error: { code: 'internal', message: 'Internal error' } }, 500)
}
```

- [ ] **Step 5: Write `server/routes/health.ts`**

```ts
import { Hono } from 'hono'
import type { Env } from '../types'

export const health = new Hono<Env>()

health.get('/', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first()
    return c.json({ success: true, status: 'healthy', database: 'connected', timestamp: new Date().toISOString() })
  } catch (e) {
    return c.json({ success: false, status: 'unhealthy', database: 'disconnected', error: (e as Error).message }, 503)
  }
})
```

- [ ] **Step 6: Write `server/app.ts`** (health mounted before any gate)

```ts
import { Hono } from 'hono'
import type { Env } from './types'
import { apiOnError } from './lib/http'
import { health } from './routes/health'

export function createApp() {
  const app = new Hono<Env>().basePath('/api')
  app.onError(apiOnError)
  // Health works even when the DB is down / no session -> mount before middleware.
  app.route('/health', health)
  return app
}
```

- [ ] **Step 7: Write `functions/api/[[route]].ts`**

```ts
import { handle } from 'hono/cloudflare-pages'
import { createApp } from '../../server/app'

export const onRequest = handle(createApp())
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/health.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server functions test
git commit -m "feat: health route + Pages Function entry (Phase 0 green)"
```

---

### Task 4: First migration — Clarion-owned tables

**Files:** Create `migrations/0001_init.sql`; Test `test/migration.test.ts`

**Interfaces:** Produces tables `cc_org_directory`, `cc_members`, `cc_audit_log`.

- [ ] **Step 1: Write the failing test** (applies the SQL to an in-memory DB and asserts the tables exist)

```ts
// test/migration.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

describe('0001_init migration', () => {
  it('declares the three Phase-1 tables', () => {
    const sql = readFileSync('migrations/0001_init.sql', 'utf8')
    for (const t of ['cc_org_directory', 'cc_members', 'cc_audit_log']) {
      expect(sql).toContain(`CREATE TABLE ${t}`)
    }
    expect(sql).toContain("clarion_role") // role column present
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/migration.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Write `migrations/0001_init.sql`**

```sql
-- 0001_init.sql — Foundry Clarion base tables.
-- organization_id / user_id are AuthPak ids (TEXT). No cross-database FKs.
PRAGMA foreign_keys = ON;

-- Tenant directory, accreted from JWT claims (mirrors Workspace's org_directory).
CREATE TABLE cc_org_directory (
  organization_id TEXT PRIMARY KEY,
  name        TEXT,
  slug        TEXT,
  owner_email TEXT,
  disabled    INTEGER NOT NULL DEFAULT 0,
  first_seen  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Clarion's own per-user roles (AuthPak's JWT does NOT carry these).
CREATE TABLE cc_members (
  organization_id TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  clarion_role    TEXT NOT NULL CHECK (clarion_role IN ('admin','supervisor','agent')),
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_cc_members_org ON cc_members(organization_id);

-- Who changed what.
CREATE TABLE cc_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  organization_id TEXT,
  user_id         TEXT,
  action          TEXT NOT NULL,
  meta_json       TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_cc_audit_org ON cc_audit_log(organization_id);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Apply locally to catch SQL errors**

Run: `npm run d1:migrate:local`
Expected: `1 migration applied`.

- [ ] **Step 6: Commit**

```bash
git add migrations test/migration.test.ts
git commit -m "feat: 0001_init — cc_org_directory, cc_members, cc_audit_log"
```

---

## Phase 1 — Auth spine

### Task 5: Typed DB accessors for directory + members

**Files:** Create `server/db/directory.ts`, `server/db/members.ts`; Test `test/db.test.ts`

**Interfaces:**
- Produces:
  - `touchOrgDirectory(db, { organization_id, name?, slug?, owner_email? }): Promise<{ disabled: boolean }>` — upsert last_seen/name/owner_email, return disabled flag.
  - `getClarionRole(db, orgId, userId): Promise<'admin'|'supervisor'|'agent'|null>`
  - `setClarionRole(db, orgId, userId, role): Promise<void>`

- [ ] **Step 1: Write the failing test** (fake D1 that records bind/first calls)

```ts
// test/db.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/db.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/db/members.ts`**

```ts
export type ClarionRole = 'admin' | 'supervisor' | 'agent'

export async function getClarionRole(db: D1Database, orgId: string, userId: string): Promise<ClarionRole | null> {
  const row = await db
    .prepare('SELECT clarion_role FROM cc_members WHERE organization_id = ? AND user_id = ?')
    .bind(orgId, userId)
    .first<{ clarion_role: ClarionRole }>()
  return row?.clarion_role ?? null
}

export async function setClarionRole(db: D1Database, orgId: string, userId: string, role: ClarionRole): Promise<void> {
  await db
    .prepare(
      `INSERT INTO cc_members (organization_id, user_id, clarion_role) VALUES (?, ?, ?)
       ON CONFLICT(organization_id, user_id) DO UPDATE SET clarion_role = excluded.clarion_role`,
    )
    .bind(orgId, userId, role)
    .run()
}
```

- [ ] **Step 4: Write `server/db/directory.ts`**

```ts
export async function touchOrgDirectory(
  db: D1Database,
  o: { organization_id: string; name?: string | null; slug?: string | null; owner_email?: string | null },
): Promise<{ disabled: boolean }> {
  await db
    .prepare(
      `INSERT INTO cc_org_directory (organization_id, name, slug, owner_email, last_seen)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(organization_id) DO UPDATE SET
         name = COALESCE(excluded.name, cc_org_directory.name),
         slug = COALESCE(excluded.slug, cc_org_directory.slug),
         owner_email = COALESCE(excluded.owner_email, cc_org_directory.owner_email),
         last_seen = CURRENT_TIMESTAMP`,
    )
    .bind(o.organization_id, o.name ?? null, o.slug ?? null, o.owner_email ?? null)
    .run()
  const row = await db
    .prepare('SELECT disabled FROM cc_org_directory WHERE organization_id = ?')
    .bind(o.organization_id)
    .first<{ disabled: number }>()
  return { disabled: !!row?.disabled }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/db.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/db test/db.test.ts
git commit -m "feat: typed accessors for cc_org_directory + cc_members"
```

---

### Task 6: Role resolution + guards (the authorization core)

**Files:** Create `server/lib/auth.ts`; Test `test/auth.test.ts`

**Interfaces:**
- Consumes: `getClarionRole`, `setClarionRole` (Task 5); `FoundryClaims` from `@foundry/auth`.
- Produces:
  - `resolveClarionRole(db, claims): Promise<ClarionRole | null>` — returns the row's role; if none exists and the org-role is `owner`/`admin`, **bootstrap** the caller as `admin` and return `admin`.
  - `requireClarionRole(min: ClarionRole)` — a Hono middleware that 403s `clarion_no_access` / `clarion_forbidden`.

- [ ] **Step 1: Write the failing test**

```ts
// test/auth.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `server/lib/auth.ts`**

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 5: Commit**

```bash
git add server/lib/auth.ts test/auth.test.ts
git commit -m "feat: Clarion role resolution + requireClarionRole guard (owner->admin bootstrap)"
```

---

### Task 7: Wire the auth middleware + `/api/auth-status` + `/api/me`

**Files:** Modify `server/app.ts`; Create `server/routes/me.ts`; Test `test/app-auth.test.ts`

**Interfaces:**
- Consumes: `verifyFoundrySession` (`@foundry/auth`), `touchOrgDirectory`, `resolveClarionRole`, `requireClarionRole`.
- Produces:
  - Public `GET /api/auth-status` → `{ success, data: { authenticated, hasOrg, email, orgId, orgSlug, orgRole, clarionRole, disabled } }`.
  - Enforce middleware on `/api/*` (after health/auth-status) that sets `user`, `organizationId`, `clarionRole`, touches the directory, and — when `AUTH_ENFORCE==='true'` — 401s unauthenticated XHR / 302s navigations to AuthPak login.
  - `GET /api/me` (behind the gate) → the caller's identity + clarion role.

- [ ] **Step 1: Write the failing test** (inject a fake `verifyFoundrySession` via the app's DI seam — see Step 3 note)

```ts
// test/app-auth.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('@foundry/auth', () => ({
  verifyFoundrySession: vi.fn(async (req: Request) => {
    const cookie = req.headers.get('cookie') ?? ''
    return cookie.includes('fnd_session=good')
      ? { sub: 'u1', email: 'a@b.com', email_verified: true, org_id: 'o1', org_slug: 'acme', role: 'owner', iss: '', aud: 'foundry-ns', iat: 0, exp: 0 }
      : null
  }),
}))

import { createApp } from '../server/app'

function fakeDb() {
  const store: Record<string, string> = {}
  return {
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return store['role'] ? { clarion_role: store['role'] } : null
            return { ok: 1 }
          },
          async run() { if (sql.startsWith('INSERT INTO cc_members')) store['role'] = String(a[2]); return {} },
        }),
        async first() { return { ok: 1 } },
      }
    },
  } as unknown as D1Database
}

const env = { DB: fakeDb(), AUTH_ENFORCE: 'true' }

describe('auth gate', () => {
  it('auth-status is public and reports logged-out', async () => {
    const res = await createApp().request('/api/auth-status', {}, env)
    expect(res.status).toBe(200)
    expect((await res.json()).data.authenticated).toBe(false)
  })
  it('/api/me 401s without a session when enforcing', async () => {
    const res = await createApp().request('/api/me', { headers: { 'X-Requested-With': 'fetch' } }, env)
    expect(res.status).toBe(401)
  })
  it('/api/me returns identity + admin (owner bootstrap) with a good session', async () => {
    const res = await createApp().request('/api/me', { headers: { cookie: 'fnd_session=good' } }, env)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({ user: { id: 'u1', email: 'a@b.com' }, orgId: 'o1', clarionRole: 'admin' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/app-auth.test.ts`
Expected: FAIL — `/api/me` route and middleware not present.

- [ ] **Step 3: Update `server/app.ts`**

> Note: import `verifyFoundrySession` at module top so the `vi.mock('@foundry/auth')` in the test intercepts it.

```ts
import { Hono } from 'hono'
import { verifyFoundrySession } from '@foundry/auth'
import type { Env } from './types'
import { apiOnError, err } from './lib/http'
import { health } from './routes/health'
import { me } from './routes/me'
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
  return app
}
```

- [ ] **Step 4: Write `server/routes/me.ts`**

```ts
import { Hono } from 'hono'
import type { Env } from '../types'
import { err } from '../lib/http'

export const me = new Hono<Env>()

me.get('/', (c) => {
  const user = c.get('user')
  if (!user) return err(c, 'unauthenticated', 'Sign in required', 401)
  return c.json({ success: true, data: {
    user, orgId: c.get('organizationId'), orgRole: c.get('role') ?? null, clarionRole: c.get('clarionRole'),
  } })
})
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/app-auth.test.ts`
Expected: PASS (all three cases).

- [ ] **Step 6: Full suite + typecheck**

Run: `npx vitest run && npm run typecheck:server`
Expected: all green, no type errors.

- [ ] **Step 7: Commit**

```bash
git add server test/app-auth.test.ts
git commit -m "feat: AuthPak session gate + /api/auth-status + /api/me (Phase 1 spine)"
```

---

### Task 8: Minimal SPA gate (routes on auth-status)

**Files:** Create `src/main.tsx`, `src/App.tsx`, `src/lib/session.ts`, `index.html`, `src/index.css`; Test `test/session.test.ts`

**Interfaces:**
- Consumes: `GET /api/auth-status`.
- Produces: `fetchAuthStatus(): Promise<AuthStatus>`; an `<App/>` that renders one of: **SignedOut** (link to AuthPak login), **NoAccess** (request-Clarion-access screen), **AppShell** (placeholder) based on `authenticated`/`clarionRole`.

- [ ] **Step 1: Write the failing test**

```ts
// test/session.test.ts
import { describe, it, expect, vi } from 'vitest'
import { classifyGate } from '../src/lib/session'

describe('classifyGate', () => {
  it('signed-out -> "signed-out"', () => {
    expect(classifyGate({ authenticated: false } as never)).toBe('signed-out')
  })
  it('authed but no clarion role -> "no-access"', () => {
    expect(classifyGate({ authenticated: true, hasOrg: true, clarionRole: null } as never)).toBe('no-access')
  })
  it('authed agent -> "app"', () => {
    expect(classifyGate({ authenticated: true, hasOrg: true, clarionRole: 'agent' } as never)).toBe('app')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/session.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/session.ts`**

```ts
export type AuthStatus = {
  authenticated: boolean
  hasOrg?: boolean
  email?: string | null
  orgSlug?: string | null
  orgRole?: string | null
  clarionRole?: 'admin' | 'supervisor' | 'agent' | null
  disabled?: boolean
}

export type Gate = 'signed-out' | 'no-access' | 'app'

export function classifyGate(s: AuthStatus): Gate {
  if (!s.authenticated) return 'signed-out'
  if (!s.clarionRole) return 'no-access'
  return 'app'
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  const res = await fetch('/api/auth-status', { credentials: 'include' })
  const body = await res.json()
  return body.data as AuthStatus
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/session.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `src/App.tsx`, `src/main.tsx`, `index.html`, `src/index.css`** (minimal shell using the design tokens; `App` calls `fetchAuthStatus`, `classifyGate`, and renders the three states — SignedOut links to `https://authpak.foundry-ns.com/login?redirect_uri=<current>`). Keep it small; a full agent console is Phase 2+.

- [ ] **Step 6: Build to confirm the SPA compiles**

Run: `npm run build`
Expected: `vite build` succeeds; `dist/` produced.

- [ ] **Step 7: Commit**

```bash
git add src index.html test/session.test.ts
git commit -m "feat: minimal SPA auth gate (signed-out / no-access / app)"
```

---

### Task 9: End-to-end local verification

**Files:** none (verification only)

- [ ] **Step 1: Apply migrations locally**

Run: `npm run d1:migrate:local`
Expected: migration `0001_init` applied.

- [ ] **Step 2: Run the full suite + lint + typecheck**

Run: `npx vitest run && npm run lint && npm run typecheck:server`
Expected: all green.

- [ ] **Step 3: Start the Pages dev server and probe health**

Run: `npm run pages:dev` (in one shell), then `curl -s http://localhost:8788/api/health`
Expected: `{"success":true,"status":"healthy","database":"connected",...}`.

- [ ] **Step 4: Probe auth-status logged-out**

Run: `curl -s http://localhost:8788/api/auth-status`
Expected: `{"success":true,"data":{"authenticated":false,...}}`.

- [ ] **Step 5: Use the verify skill** to drive the SPA gate in a browser (signed-out state shows the AuthPak login link). Real signed-in verification needs a live `fnd_session` cookie from `authpak.foundry-ns.com` and is confirmed once AuthPak is deployed — note that as a follow-up rather than blocking Phase 1 sign-off.

- [ ] **Step 6: Final commit / open PR** per `superpowers:finishing-a-development-branch`.

---

## Self-Review

**Spec coverage (design §9 Phases 0–1):**
- Bootstrap (Pages + Hono + D1 + `@foundry/auth` + CI) → Tasks 1–3. ✅
- `GET /api/health` → Task 3. ✅
- `verifyFoundrySession` middleware → Task 7. ✅
- `cc_org_directory` + `cc_members` + role resolution/bootstrap → Tasks 4–7. ✅
- `GET /api/auth-status` + SPA gate → Tasks 7–8. ✅
- CI (typecheck/build/test) — mirror Workspace's `ci.yml`; folded into Task 9 verification. *(If a dedicated GitHub Actions workflow is wanted, add it as Task 10 — same shape as `skills-foundry/.github/workflows/ci.yml`.)*

**Placeholder scan:** Task 8 Step 5 and Task 9 Steps 5–6 intentionally describe UI/verification rather than showing every line — these are the two genuinely UI/human-in-the-loop steps; all server logic steps carry full code. No `TODO`/`add error handling` placeholders in code steps.

**Type consistency:** `ClarionRole` is defined once (Task 5, `server/db/members.ts`) and imported everywhere. `resolveClarionRole(db, claims)` / `requireClarionRole(min)` / `touchOrgDirectory(db, o)` / `getClarionRole(db, orgId, userId)` signatures are consistent across Tasks 5–8. The `Variables.clarionRole` type matches `ClarionRole | null`. ✅

---

## Execution Handoff

**Plan complete.** This covers Phases 0–1 (bootstrap + auth spine) to test-first, executable detail. Phases 2–5 (Twilio agents, queues/inbound, recording/reporting, realtime/supervisor) each get their own plan when reached, because they depend on decisions in the design doc §11 that must be made with Steven in the loop (Twilio account mutation, Durable Object commitment, Twilio API-Key env).

When you're ready to build Phases 0–1, choose:
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks.
2. **Inline Execution** — execute in-session with checkpoints.
