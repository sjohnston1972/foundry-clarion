# Foundry Clarion — Architecture & Design

> **Status:** Decisions locked 2026-07-13 (walked through with Steven). Renamed from
> "Foundry Connect" to **Foundry Clarion** to avoid confusion with Amazon Connect.
> **Author:** Clarion agent (Claude Code session in `foundry-clarion`).
> **How to read this:** §1 is the summary. §2 records where reality (from the sibling
> repos) diverged from the original `CLAUDE.md` and what we decided. §3 onward is the
> design. Companion plan: `docs/superpowers/plans/2026-07-13-foundry-clarion-phase-0-1.md`.
>
> **Locked decisions (2026-07-13):** ① Clarion owns its own D1 (`foundry-clarion-db`) +
> read-only bind of Workspace's D1; agents = Workspace **resources linked by email**, skills
> snapshotted for routing. ② Stateless JWKS auth via `@foundry/auth`. ③ Clarion roles in
> `cc_members`. ④ One shared TaskRouter workspace, tenant-tagged, **logical + defense-in-depth**
> isolation. ⑤ **Durable Object realtime from the start** (per-org hub). ⑥ v1 = inbound +
> click-to-call.

---

## 1. Summary

Foundry Clarion is a CCaaS product for the Foundry family (`clarion.foundry-ns.com`),
built as a **Cloudflare Pages + Pages Functions (Hono) + D1 + R2** app with a **React 19
+ Vite + Tailwind v4** frontend — mirroring Skills Foundry (Workspace) and AuthPak exactly.
It puts a **custom agent UI on top of raw Twilio** (TaskRouter, Voice, Programmable Voice
browser SDK) — **no Flex**. Authentication is **not built here**: Clarion verifies the
AuthPak `fnd_session` JWT statelessly via JWKS using the vendored `@foundry/auth` package,
exactly as Workspace already does.

This design was written after reading `authpak/SPEC.md`, the `@foundry/auth` package,
`skills-foundry` (Workspace) server + migrations, and the `foundry` marketing site's
existing Twilio IVR worker. Several load-bearing assumptions in `CLAUDE.md` turned out to
be inaccurate against the actual code; those are called out in §2 and drive the design.

---

## 2. Corrections to CLAUDE.md (now decided — 2026-07-13)

`CLAUDE.md` was written before AuthPak and Workspace reached their current shape. The
following are grounded in the sibling repos as they exist today. Items that changed a
"locked" decision were **walked through with Steven on 2026-07-13 and are now settled**;
CLAUDE.md §2/§5/§6/§7/§9/§11 have been updated to match.

### 2.1 🔴 There is no shared users table and no shared D1 to FK into

`CLAUDE.md` §2 & §6 say: *"Shared Cloudflare D1 database with Workspace. Clarion reads
Workspace's `users`, `orgs`, `roles` tables directly… queue membership is a real FK to
`users.id`."*

Reality:
- **AuthPak owns identity** in its **own** D1 (`authpak-db`): `user`, `organization`,
  `member`, `role`. (`authpak/SPEC.md` §4.)
- **Workspace has its own separate D1** (`skills-foundry-db`, id
  `2bdbcd5d-9559-434b-87b0-e2db99f8ce97`). It has **no `users` table at all** — it has
  `resources` (tracked people) and it learns the logged-in identity purely from the JWT.
  (`skills-foundry/migrations/0001_init.sql`, `wrangler.jsonc`.)
- D1 databases are isolated SQLite instances; **you cannot declare a foreign key from one
  D1 database into another.** So "FK to Workspace `users.id`" is not implementable as
  written, and there is no single shared DB that both apps read.

How the family actually handles this: each app **owns its own D1**, gets identity from the
`fnd_session` JWT, and **accretes a tenant directory from JWT claims**. Workspace does this
with its `org_directory` table (`migrations/0011_admin.sql`):

```sql
-- Skills Foundry doesn't own the identity store (AuthPak does), so it accumulates a
-- directory of the orgs that use it from the JWT claims on each authenticated request.
CREATE TABLE IF NOT EXISTS org_directory (
  organization_id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_email TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

**Recommendation:** Clarion owns its **own D1** (`foundry-clarion-db`), mirrors the
`org_directory` pattern, scopes every row by `organization_id TEXT` (the AuthPak org id,
e.g. `org_legacy`), and stores the AuthPak `user_id` (JWT `sub`, TEXT) as a **logical
reference, not an enforced FK**. This matches AuthPak and Workspace, respects the
multi-agent contract (Clarion must never migrate Workspace's DB), and is the only option
that actually works given D1 isolation.

**DECIDED:** Clarion owns its own D1 (`foundry-clarion-db`).

**But agents *are* Workspace resources — linked by email, with a read-only Workspace DB
binding.** The clarifying point Steven raised: the people who act as Clarion agents are the
existing Workspace `resources`. That works and is genuinely "shared resources," via three facts:
- **The join key is email.** Workspace itself maps a logged-in user to a `resources` row by
  `lower(claims.email) = lower(resources.email)` (see `skills-foundry/server/lib/grants.ts`,
  `groups.ts`, `approvers.ts`). Clarion uses the same key: `cc_agents.email` + `workspace_resource_id`.
- **A single D1 can be bound to multiple apps.** Clarion binds `skills-foundry-db` **read-only**
  as a second binding (`WORKSPACE_DB`) to (a) let an admin pick from Workspace resources when
  enabling an agent and (b) read their skills. Reading is allowed; the contract only forbids
  *commits/migrations* to Workspace. **Clarion never writes to `WORKSPACE_DB`.**
- **Live routing uses a Clarion-owned snapshot, not a live cross-DB read.** At "enable as agent"
  time, Clarion copies the resource's skills into `cc_agent_skills` (re-syncable). So a live call
  never waits on Workspace's DB, and Clarion is resilient to Workspace downtime. (D1 cannot JOIN
  across two databases anyway — you read each binding and join in app code.)

What is *not* possible: putting Clarion's `cc_*` tables inside Workspace's DB (contract +
independent migrations), or a single physical DB serving both apps. Each app owns its own D1.

### 2.2 🔴 Auth is stateless JWKS verification, not a server-to-server verify call

`CLAUDE.md` §5 says: *"Call AuthPak's session-verify endpoint on every request… receive back
`{ user_id, org_id, roles }`."*

Reality (`authpak/SPEC.md` §2, §5, §9; `@foundry/auth`): relying parties **verify the JWT
locally via AuthPak's JWKS** with **no per-request network call**. The vendored package
does exactly this:

```ts
import { verifyFoundrySession } from '@foundry/auth'
const claims = await verifyFoundrySession(c.req.raw) // reads fnd_session cookie, verifies via cached JWKS
// claims: { sub, email, email_verified, name?, org_id?, org_slug?, role?, orgs?, iss, aud, iat, exp }
```

Consequences for our env/design:
- Cookie name is **`fnd_session`** (not "TBC"). Access JWT ~15 min; silent refresh via
  `POST https://authpak.foundry-ns.com/api/token/refresh` using the `fnd_refresh` cookie.
- **No `AUTHPAK_SHARED_SECRET` is needed** — verification uses the public JWKS. Drop that
  env var from `CLAUDE.md` §9.
- AuthPak base URL is **`https://authpak.foundry-ns.com`** (CLAUDE.md §9 guessed
  `auth.foundry-ns.com`).
- JWT audience is **`foundry-ns`**; issuer `https://authpak.foundry-ns.com`.

### 2.3 🟢 Clarion's own roles must live in a Clarion table (resolves open question §11-Q1)

The `fnd_session` JWT only carries the **org-level** role (`owner` | `admin` | `member`).
It does **not** carry `clarion:admin` / `clarion:supervisor` / `clarion:agent`. AuthPak's
SPEC is explicit that per-app entitlements are the consuming app's job (SPEC §10). So
Clarion's roles **must** live in a Clarion-owned table, keyed by `(organization_id,
user_id)`. This closes CLAUDE.md open question §11 Q1: **Clarion roles live in Clarion.**

Mapping we'll use: AuthPak `owner`/`admin` → bootstrapped as Clarion `admin` on first
access (so an org owner can always administer Clarion); everyone else defaults to no
Clarion access until an admin grants a Clarion role.

### 2.4 🟢 "Workspace" is `workspace.foundry-ns.com` (repo stays `skills-foundry`)

The product rebranded from "Skills Foundry" to "Foundry Workspace"; `skills.foundry-ns.com`
301s to `workspace.foundry-ns.com`. Infra names (Pages project, D1, repo) keep the
`skills-foundry` name. No action beyond using the right URLs in copy/redirects.

### 2.5 🟢 Confirmed tech stack (CLAUDE.md §8 "confirm on first session")

From `skills-foundry/package.json`, `wrangler.jsonc`, and `authpak/SPEC.md` §3:

| Concern | Choice (mirror exactly) |
|---|---|
| Language | TypeScript (`~6.0` in Workspace) |
| Backend | **Hono** as **Pages Functions** — `functions/api/[[route]].ts` mounting a `server/` app |
| Frontend | **React 19 + Vite + Tailwind v4**, `react-router-dom` v7, `@tanstack/react-query` v5 |
| DB | Cloudflare **D1** (own database) |
| Object storage | **R2** (recordings + transcripts) |
| Auth | `@foundry/auth` (vendored tarball `file:vendor/foundry-auth-0.1.0.tgz`) |
| Lint | **oxlint** |
| Tests | **Vitest** (+ Playwright available) |
| Deploy | `wrangler pages deploy`; D1 via `wrangler d1 migrations apply` |
| Package manager | **npm** |
| Design tokens | canvas `#f6f7f9`, ink `#0f172a`, muted `#64748b`, hairline `#e6e8ec`, accent `#00a3ff`; fonts Space Grotesk (display) / Inter (body) / JetBrains Mono (data) |
| CF account | `5bdc4d7840e522355b86631e6b8fac2b`; zone `foundry-ns.com` = `48950acef28da6dccecea951ff74dce1` |

### 2.6 🟢 Prior art: the marketing site already speaks Twilio Voice

The `foundry` repo (public site `foundry-ns.com`) already implements Twilio Voice IVR in
`worker/index.ts`: office-hours dial-through, out-of-hours voicemail with transcription
email, TwiML responses, and it holds `TWILIO_AUTH_TOKEN` / `TWILIO_ACCOUNT_SID`. Clarion is
the productised, multi-tenant version of that. Useful as a reference for TwiML shape and
webhook signature validation, **but Clarion does not share its worker or its `chat-logs`
D1** — it's a separate app.

---

## 3. System context

```
                         Browser (agent / supervisor / admin)
                                     │  fnd_session cookie (.foundry-ns.com)
                                     ▼
   ┌──────────────────────── clarion.foundry-ns.com ─────────────────────────┐
   │  Cloudflare Pages (React SPA)  +  Pages Functions (Hono, server/)         │
   │    • verifyFoundrySession() via AuthPak JWKS (stateless)                  │
   │    • mints short-lived Twilio Access Tokens (Voice + TaskRouter grants)   │
   │    • owns foundry-clarion-db (D1) + read-only bind of skills-foundry-db   │
   │    • recordings bucket (R2) + per-org Durable Object realtime hub         │
   └───────┬───────────────────────┬───────────────────────┬─────────────────┘
           │ JWKS (cached)          │ Twilio REST + webhooks │ browser softphone
           ▼                        ▼                        ▼
   authpak.foundry-ns.com     Twilio (TaskRouter,      Twilio Programmable
   (identity, JWT, orgs,       Voice, Studio,           Voice JS SDK in the
    members)                   Conversations)           agent's browser
```

- **Identity** comes only from the JWT. Clarion never sees a password.
- **Tenant scope** is `organization_id` (AuthPak org id) on every Clarion row and every
  Twilio TaskRouter attribute.
- **Who can be enabled as an agent** = the org's **Workspace resources**, read from the
  read-only `WORKSPACE_DB` binding and matched to a login by **email**. (AuthPak's
  `GET /api/organizations/:id/members` is an alternative source for pure logins — see §7.4.)

---

## 4. Data model (`foundry-clarion-db`)

All Clarion tables are prefixed `cc_`. `organization_id` and `user_id` are **TEXT**
(AuthPak ids). No cross-database foreign keys. Within Clarion, FKs are used normally.

| Table | Purpose | Key columns |
|---|---|---|
| `cc_org_directory` | Tenant directory, accreted from JWT claims (mirrors Workspace) | `organization_id` PK, `name`, `slug`, `owner_email`, `disabled`, `first_seen`, `last_seen` |
| `cc_members` | **Clarion roles** per user (resolves §2.3) | `organization_id`, `user_id`, `clarion_role` CHECK in (`admin`,`supervisor`,`agent`), `created_at`, UNIQUE(`organization_id`,`user_id`) |
| `cc_agents` | A member enabled as a live agent; **linked to a Workspace resource by email** | `id` PK, `organization_id`, `user_id`, `email`, `workspace_resource_id`, `twilio_worker_sid`, `status`, `activity_sid`, `enabled_at` |
| `cc_skills` | Skill catalog per org (may be seeded from Workspace skill names) | `id` PK, `organization_id`, `name` |
| `cc_agent_skills` | Skills for routing — **snapshotted from Workspace at enable-time**, re-syncable | `agent_id`, `skill_id`, `proficiency`, `synced_at`, UNIQUE(`agent_id`,`skill_id`) |
| `cc_queues` | Call queues (TaskRouter Workflow targets) | `id` PK, `organization_id`, `name`, `twilio_workflow_sid`, `strategy` |
| `cc_queue_members` | Agents in queues | `queue_id`, `agent_id`, `priority`, UNIQUE(`queue_id`,`agent_id`) |
| `cc_hunt_groups` | Simple ring groups | `id` PK, `organization_id`, `name`, `strategy` (`ring-all`/`round-robin`) |
| `cc_ivr_flows` | Studio flow references | `id` PK, `organization_id`, `name`, `twilio_flow_sid`, `definition_json` |
| `cc_numbers` | Provisioned Twilio numbers | `id` PK, `organization_id`, `e164`, `twilio_number_sid`, `assigned_kind`, `assigned_id` |
| `cc_calls` | Call log for reporting | `id` PK, `organization_id`, `twilio_call_sid`, `from_e164`, `to_e164`, `queue_id`, `agent_id`, `disposition`, `duration_s`, `started_at` |
| `cc_recordings` | Recording metadata (audio in R2) | `id` PK, `call_id`, `r2_key`, `duration_s`, `transcript_r2_key`, `created_at` |
| `cc_audit_log` | Who changed what (mirror Workspace's audit table) | `id` PK, `organization_id`, `user_id`, `action`, `meta_json`, `created_at` |

**Read-only Workspace binding:** `wrangler.jsonc` binds `skills-foundry-db` as a second D1
binding named `WORKSPACE_DB`. Clarion reads `resources` + `resource_sub_skills` (scoped to the
caller's org via `departments.organization_id`) to pick agents and snapshot skills. It **never
writes** to `WORKSPACE_DB`. Own data lives in the `DB` binding (`foundry-clarion-db`).

**Conventions (from CLAUDE.md §10, matched to Workspace):**
- Every table gets a typed accessor in `src/db/<table>.ts` — no raw SQL in handlers.
- Every query filters by `organization_id`. A shared `scopedDb(orgId)` helper enforces it, and
  cross-tenant leak tests assert a query for org A never returns org B's rows.
- Recording audio + transcripts live in **R2**; D1 holds only metadata + R2 keys.
- Route handler order is fixed: **input validation → auth check → business logic → response.**
- Errors are JSON `{ error: { code, message } }`; never leak stack traces. (Note: Workspace
  actually returns `{ success, data }` envelopes for success — we'll match that for parity.)

---

## 5. Request lifecycle & authorization

Every `/api/*` request (Hono middleware, mirroring `skills-foundry/server/app.ts`):

1. `const claims = await verifyFoundrySession(c.req.raw)` — never throws; returns claims or `null`.
2. If `null` → for XHR return `401`; for navigations `302` to
   `https://authpak.foundry-ns.com/login?redirect_uri=<url>`. (The SPA does a silent
   `POST /api/token/refresh` once before giving up — same as Workspace.)
3. Set context: `user = { id: sub, email, emailVerified, name }`, `orgId = claims.org_id`,
   `role = claims.role` (the **org** role).
4. **Touch `cc_org_directory`** (upsert `last_seen`, `name`, `owner_email`) so Clarion
   accumulates its tenant list. Refuse if `disabled = 1`.
5. **Resolve Clarion role** from `cc_members`. If the user is an org `owner`/`admin` and has
   no `cc_members` row, auto-provision them as Clarion `admin` (bootstrap). Otherwise, no
   Clarion role → `403 clarion_no_access` (SPA shows a "request access" screen).
6. Authorization guards per route:
   - `requireClarionRole('admin')` — provisioning (queues, numbers, enabling agents).
   - `requireClarionRole('supervisor')` — org-wide queue visibility, monitor/whisper/barge.
   - `requireClarionRole('agent')` — softphone, take calls, own state only.

A public `GET /api/auth-status` (mounted **before** the enforce gate, like Workspace) tells
the SPA how to route: logged-out → marketing/login, logged-in-without-Clarion-role →
request-access, agent/supervisor/admin → the app.

---

## 6. Twilio integration & the recommendations you asked me to make

Because we chose the custom-UI path, Clarion drives Twilio's primitives directly. The open
questions in CLAUDE.md §11 get concrete recommendations here.

### 6.1 One shared TaskRouter Workspace, tenant-tagged — DECIDED; isolation = defense-in-depth

**Decision: a single Twilio TaskRouter Workspace for all Foundry orgs**, with every Worker,
Workflow (queue), TaskQueue, and Task carrying an `organization_id` attribute. Routing
expressions and every REST query filter on it.

Steven's bar was "super secure, no possibility of data bleed." Honest framing: the whole
Foundry family uses **logical** isolation on shared infra (Workspace is a single D1 scoped by
org). "No *possibility*" in the literal sense means physical per-tenant isolation, which the
family did not adopt. We get to a very high bar with **defense-in-depth**:

- **Agents are isolated by Twilio itself.** Each agent's browser gets a **per-worker Access
  Token** that grants only *that worker's own* reservations/events. An agent **physically
  cannot** see another org's — or even another agent's — tasks through their token. This is
  Twilio-enforced, not filter-enforced.
- **Server-side is the only logical surface.** Supervisor/admin queries run server-side and are
  the one place org-scoping is by discipline. Every TaskRouter call goes through a single
  mandatory `taskrouterScoped(orgId)` wrapper (deny-by-default), and **cross-tenant leak tests**
  assert a query for org A returns nothing from org B.
- **Realtime is isolated by construction** — the per-org Durable Object (§6.4) means one org's
  live state/sockets never share an instance with another's.
- *Why not one workspace per org:* heavyweight account objects; per-tenant multiplies webhook
  wiring and account-limit risk. *Escape hatch (dedicated tier):* a specific tenant can be moved
  to its own TaskRouter workspace later **without a data-model change** (`cc_*` already keys by org).
- **SID lives in env** as `TWILIO_TASKROUTER_WORKSPACE_SID`.

### 6.2 Explicit "enable as agent" (recommend) — CLAUDE.md §11-Q3

A Workspace user assigned to a Clarion queue does **not** silently get a TaskRouter Worker.
An admin explicitly **enables** them as an agent, which (a) creates `cc_agents` + the Twilio
Worker on demand and (b) makes the billing impact visible. This matches CLAUDE.md's own
recommendation and Workspace's "make seats explicit" posture.

### 6.3 Access Tokens minted server-side

The browser softphone needs a short-lived **Twilio Access Token** with a **Voice grant**
(TwiML app SID) and a **TaskRouter Worker grant**. Clarion mints these in a Pages Function
from `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` — **never** exposing the auth token to
the client. Tokens are ~1h, refreshed by the SPA. (These two API-key vars are **not yet in
`.env`** — see §10.)

### 6.4 Realtime agent state: Durable Object from the start — DECIDED

**One Durable Object per org** is the realtime hub from day one (Steven's call). TaskRouter
event webhooks → the org's DO (addressed by `idFromName(org_id)`) → WebSocket fan-out to that
org's connected supervisor/agent browsers. The agent's own softphone events still come directly
from the Twilio Voice JS SDK; the DO drives **presence, wallboards, and supervisor views**.

- **Isolation benefit:** a DO instance is per-org by construction — one org's sockets and live
  state never share an instance, so the realtime layer is isolated without a filter (reinforces §6.1).
- **Deployment shape:** adds a `durable_objects` binding + a migration in `wrangler.jsonc`, and a
  `ClarionRealtime` DO class. Introduced in the phase that first has live agents (§9 Phase 2), not
  the auth-spine phases.
- **Backpressure/limits:** one DO per org bounds fan-out to a single org's connection count;
  reconnect with resume tokens; heartbeat to prune dead sockets.

### 6.5 Inbound flow (v0.1 target)

```
PSTN call → Twilio Number → Studio Flow (IVR) or directly → TwiML webhook on Clarion
   → enqueue Task {organization_id, queue, required skills} into TaskRouter
   → Workflow matches an available Worker (agent) by skills/priority
   → Reservation → agent's browser softphone rings (Voice SDK)
   → agent accepts → media bridges → wrap-up → cc_calls + (optional) cc_recordings
```

TwiML/status webhooks are Clarion Pages Functions, **signature-validated** with the Twilio
auth token (reuse the pattern already in the `foundry` marketing worker).

### 6.6 Outbound: receive-only + click-to-call in v1 (recommend) — CLAUDE.md §11-Q6

Recommend v1 = inbound **plus click-to-call**. Once the inbound softphone works, outbound
click-to-call is nearly free (same Voice SDK, an outbound TwiML endpoint). A full
predictive/preview **dialer** is out of scope for v1. Conversations API (SMS/WhatsApp/chat)
stays modelled but unbuilt (CLAUDE.md §7).

### 6.7 Twilio account-mutating calls are gated

Per CLAUDE.md §4.5 and §12: **buying numbers, creating the TaskRouter Workspace/Workflows,
creating Studio flows** all cost money or change account state and require **explicit
in-session confirmation from you** before the code runs. The plan isolates these behind a
single `provisioning/` module and a `DRY_RUN` flag so everything up to the mutating call is
testable without touching the account.

---

## 7. AuthPak & Workspace integration contract

### 7.1 What Clarion consumes from AuthPak (read-only, already exists)
- `GET /.well-known/jwks.json` — JWKS (cached by `@foundry/auth`).
- The `fnd_session` cookie / JWT claims — identity + org + org-role.
- `POST /api/token/refresh` — silent access-token refresh (called by SPA).
- `GET /api/organizations/:id/members` — to list users who can be enabled as agents (§7.4).

### 7.2 What Clarion owns (not AuthPak's job)
- Clarion roles, agents, queues, all telephony state, recordings, call reporting.

### 7.3 What Clarion must **not** do (from CLAUDE.md §12)
- No login page, no user directory, no token minting for anything AuthPak covers, no
  commits in `authpak/` or `skills-foundry/`.

### 7.4 Server-to-server AuthPak calls → request a `clarion` service client
Listing org members (§7.1) via `GET /api/organizations/:id/members` is easy for
**browser-driven** calls (the `fnd_session` cookie rides along on `.foundry-ns.com`). For
**server-to-server** calls (e.g. a cron reconciliation with no user present), a mechanism
already exists: Workspace's `server/types.ts` carries `AUTHPAK_CLIENT_SECRET` — *"HMAC
signing secret for AuthPak service calls (service client id: `foundry`)."* So AuthPak
supports HMAC-signed service calls keyed by a **service client id**.

**Action when we need it:** Clarion should get its **own** service client id (e.g.
`clarion`) + secret rather than reuse Workspace's `foundry` credential. Since minting a new
service client is an AuthPak-side change, write
`docs/change-requests/authpak-clarion-service-client.md` and stop (per CLAUDE.md §3), then
set `AUTHPAK_CLIENT_SECRET` in Clarion's env. **For v0.1 we only need the browser-driven
member list, so this is deferred, not blocking.**

---

## 8. Security (build to these — from AuthPak SPEC §11 + CLAUDE.md §12)

- **Never** put Twilio auth token, API key secret, or any AuthPak secret in the frontend
  bundle. The browser only ever gets short-lived Twilio Access Tokens.
- Validate **Twilio webhook signatures** (`X-Twilio-Signature`) on every inbound webhook.
- Enforce `organization_id` scoping on **every** D1 query and **every** TaskRouter call; test
  cross-tenant isolation explicitly.
- Respect `cc_org_directory.disabled` (a suspended tenant is refused, like Workspace).
- Recording consent/prompts are a **product/legal decision you own** (CLAUDE.md §11) — the
  code exposes a per-org toggle and a per-number announcement, but the default and the
  jurisdiction rules are yours to set.
- Error envelopes never leak stack traces; server faults are logged for `wrangler tail`.

---

## 9. Phased roadmap

| Phase | Deliverable | Gated on |
|---|---|---|
| **0 — Bootstrap** | Vite React+TS+Tailwind app + Hono Pages Functions + `foundry-clarion-db` D1 binding + `@foundry/auth` vendored + CI. `GET /api/health` → `{ ok: true }`. | — |
| **1 — Auth spine** | `verifyFoundrySession` middleware; `cc_org_directory` + `cc_members` + Clarion-role resolution/bootstrap; `GET /api/auth-status`; SPA gate (logged-out / no-access / in). | — |
| **2 — Agents, skills & realtime spine** | `WORKSPACE_DB` read-only binding; enable-as-agent flow (pick a Workspace resource by email, snapshot skills into `cc_agent_skills`); `cc_agents`/`cc_skills`; **mints Twilio Access Tokens**; **per-org Durable Object (`ClarionRealtime`) stood up** for presence; browser softphone registers (no live inbound yet). | Twilio API Key env (§10); **create TaskRouter Workspace** (your OK). |
| **3 — Queues & inbound calls** | `cc_queues`/`cc_queue_members`, TaskRouter Workflows, inbound TwiML + status webhooks → org's DO → live agent state; reservation → softphone → wrap-up → `cc_calls`. | **Buy a number / create Workflow** (your OK). |
| **4 — Recording & reporting** | R2 recording capture + `cc_recordings`, transcripts, reporting views. | Recording-consent product decision (yours). |
| **5 — Supervisor & outbound** | Live wallboard on the DO stream, monitor/whisper/barge, click-to-call outbound. | — |

Phases 0–1 are specified to executable, test-first detail in the companion plan. Phases 2+
each get their own plan when we reach them, because they depend on the Twilio account-mutation
points (create workspace, buy number) that must be confirmed with you in the loop.

---

## 10. Environment variables (corrected vs CLAUDE.md §9)

Already present in `.env`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`.

Note: the read-only Workspace binding (`WORKSPACE_DB` → `skills-foundry-db`, id
`2bdbcd5d-9559-434b-87b0-e2db99f8ce97`) and the Durable Object (`ClarionRealtime`) are
declared in **`wrangler.jsonc`**, not `.env`.

**Add** (Clarion-specific):
```
# Cloudflare
D1_DATABASE_ID=            # foundry-clarion-db (Clarion's OWN db, created in Phase 0)
R2_BUCKET_RECORDINGS=foundry-clarion-recordings

# AuthPak (per-request verification is via public JWKS — NO secret needed for that)
AUTHPAK_BASE_URL=https://authpak.foundry-ns.com     # for login/refresh redirects only
# (verifyFoundrySession defaults already target authpak.foundry-ns.com / aud "foundry-ns")
AUTHPAK_CLIENT_SECRET=     # ONLY if/when Clarion makes server-to-server AuthPak calls (§7.4);
                          # requires a `clarion` service client minted on AuthPak's side first

# Twilio — needed from Phase 2
TWILIO_API_KEY_SID=        # NOT YET PRESENT — needed to mint Access Tokens
TWILIO_API_KEY_SECRET=     # NOT YET PRESENT
TWILIO_TASKROUTER_WORKSPACE_SID=   # created in Phase 2 (your OK)
TWILIO_TWIML_APP_SID=              # created in Phase 2 (your OK)

# App
APP_BASE_URL=https://clarion.foundry-ns.com
LOG_LEVEL=info
```
**Removed from CLAUDE.md's list:** `AUTHPAK_SHARED_SECRET` (not used — JWKS is public),
`AUTHPAK_COOKIE_NAME` (it's a fixed contract: `fnd_session`).

`.env` must stay gitignored — confirm `.gitignore` before the first commit (CLAUDE.md §9).

---

## 11. Decisions — status

**Locked 2026-07-13:**
1. ✅ **Clarion owns its own D1** + read-only `WORKSPACE_DB` binding; agents = Workspace resources by email, skills snapshotted (§2.1, §4).
2. ✅ **Stateless JWKS auth** via `@foundry/auth` (§2.2).
3. ✅ **Clarion roles in `cc_members`** (§2.3).
4. ✅ **Shared TaskRouter workspace, tenant-tagged**, logical + defense-in-depth isolation (§6.1).
5. ✅ **Durable Object realtime from the start**, per-org hub (§6.4).
6. ✅ **v1 = inbound + click-to-call**, no predictive dialer (§6.6).

**Still yours to decide (not blocking Phases 0–2):**
- **Recording consent** defaults & jurisdiction rules (§8) — product/legal call.
- **Twilio account-mutation** go-points (create workspace, buy number, create Workflow/Flow) — each needs an explicit in-session "go" (§6.7).
- **Dedicated-isolation tier** — if/when a tenant demands physical isolation, move that org to its own TaskRouter workspace (no data-model change).
- **`clarion` AuthPak service client** — only if server-to-server AuthPak calls are needed (§7.4).

None block Phases 0–1 (companion plan) or Phase 2.
