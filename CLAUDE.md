# Foundry Clarion — CLAUDE.md

> **What this file is (for Steven, not for the agent):**
> A CLAUDE.md is the first thing every Claude Code session reads when it opens
> this repo. It's the standing brief: the goals, the rules, the boundaries,
> the "we already decided this — don't relitigate it." Anything you find
> yourself explaining twice belongs here.
>
> **For the agent:** read this file end-to-end before touching anything.
> It is the source of truth for architecture and for the multi-agent contract
> you are operating under.

---

## 1. Project north star

**Foundry Clarion** is a Contact Centre as a Service (CCaaS) product that
lives inside the **Foundry** SaaS platform.

- **Public URL:** `clarion.foundry-ns.com`
- **Parent platform:** `workspace.foundry-ns.com` (repo: `skills-foundry`)
- **Auth provider:** AuthPak (repo: `authpak`) — shared with Workspace
- **Telephony:** Twilio (TaskRouter, Voice, Conversations APIs) — **not Flex UI**
- **Hosting:** Cloudflare (Workers + Pages, D1)

The product lets a Workspace tenant provision and run a small-to-mid-size
contact centre: inbound queues, hunt groups, IVR flows, skills-based routing,
recording, and assigning existing Workspace users as agents/supervisors.

If you find yourself doing something that doesn't obviously serve that goal,
stop and ask the human.

---

## 2. Key architectural decisions (already made — do not relitigate)

| Decision | Choice | Why |
|---|---|---|
| Twilio consumption model | **Custom agent UI on top of Twilio's raw APIs** (TaskRouter, Voice, Conversations). We do **not** embed Twilio's Flex UI. | Native look/feel matching Workspace; full control over UX; avoids Flex licensing per-seat lock-in. |
| Multi-agent workflow | **One Claude Code session per repo.** Three sessions total: `clarion`, `authpak`, `skills-foundry`. | Clean blast radius per agent; matches Steven's `multiclaude` pattern; forces explicit cross-repo contracts. |
| Data storage | **Clarion owns its own D1 (`foundry-clarion-db`).** It additionally binds Workspace's `skills-foundry-db` **read-only** to source resource/skill data. Agents link to Workspace `resources` **by email**. Scope every row by `org_id` (TEXT). | AuthPak & Workspace each own their own D1; D1 can't FK across databases and Workspace has no `users` table. See §6 + `docs/design/foundry-clarion-design.md`. |
| Auth | **Stateless JWKS verification of the AuthPak `fnd_session` JWT** via the vendored `@foundry/auth` package. **No per-request call to AuthPak.** Cookie name `fnd_session`; audience `foundry-ns`. | It's how Workspace already integrates; verify locally against AuthPak's JWKS. |
| Tenancy | **Org-scoped, logical isolation + defense-in-depth.** Every Clarion row/Twilio object carries `org_id`; enforced by a `scoped(orgId)` layer, per-worker Twilio tokens, per-org Durable Object, and cross-tenant leak tests. | Matches Workspace (single D1 scoped by org); SaaS norm. Dedicated per-tenant isolation can be added later without a data-model change. |

> **Decisions locked 2026-07-13** (superseding the original drafts of the rows above):
> Clarion owns its own D1 + read-only Workspace binding; auth is stateless JWKS via
> `@foundry/auth`; **Clarion roles live in a Clarion table** (`cc_members`); shared TaskRouter
> workspace tenant-tagged with logical+defense-in-depth isolation; **Durable Object realtime
> from the start**; v1 = inbound + click-to-call. Full rationale in
> `docs/design/foundry-clarion-design.md` §2. If a further change is needed, raise it before writing code.

---

## 3. Repo map — you are here

```
┌─────────────────────────────────────────────────────────────┐
│                    foundry-ns.com                            │
│                                                              │
│   ┌──────────────┐   ┌─────────────┐   ┌────────────────┐    │
│   │  workspace   │   │   authpak   │   │    clarion     │    │
│   │  (parent)    │──▶│  (auth)     │◀──│  (THIS REPO)   │    │
│   │ skills-      │   │             │   │                │    │
│   │ foundry repo │   │             │   │                │    │
│   └──────────────┘   └─────────────┘   └────────────────┘    │
│          │  read-only bind ▲ (resources by email)          │
│          └── AuthPak JWT (JWKS) ──┴── each app owns its D1 ──┘
└─────────────────────────────────────────────────────────────┘
```
(Identity is shared via the AuthPak JWT, **not** a shared database. Each app owns its
own D1; Clarion binds Workspace's D1 read-only to read `resources`/skills.)

| Repo | GitHub | Your access from this session |
|---|---|---|
| `foundry-clarion` (this one) | `github.com/sjohnston1972/foundry-clarion` | **Read + write** |
| `authpak` | `github.com/sjohnston1972/authpak` | **Read only.** If Clarion needs an AuthPak change, write a short spec in `/docs/change-requests/authpak-<slug>.md` and stop. The AuthPak session will pick it up. |
| `skills-foundry` (Workspace) | `github.com/sjohnston1972/skills-foundry` | **Read only.** Same rule — spec change requests under `/docs/change-requests/workspace-<slug>.md`. |

**Why this matters:** three agents will be running in parallel. If each one
edits whatever it needs, they'll trample each other and produce merge chaos.
The change-request pattern makes cross-repo work explicit and traceable.

---

## 4. Multi-agent contract

You are the **Clarion agent**. Rules:

1. **Never `git commit` or `git push` in `authpak/` or `skills-foundry/`.**
   You may read them (they should be cloned as siblings, or as git submodules
   under `/vendor/` — confirm with the human on first session).
2. **Do not assume APIs exist just because they'd be convenient.** Before
   calling `authpak.verifySession()` or a Workspace endpoint, open the
   referenced repo and check the actual signature. If it doesn't exist,
   write a change request (see §3) instead of stubbing.
3. **Contract changes are two-sided.** If you change a Clarion API that
   Workspace consumes, update `/docs/api-contracts/` in Clarion *and* file
   a change request for Workspace.
4. **Feature branches, not `main`.** Branch name pattern: `feat/<area>-<short-desc>`,
   e.g. `feat/queues-provisioning`. Never push to `main` directly.
5. **Confirm before touching Twilio account state.** Twilio side-effects
   (creating TaskRouter Workspaces, buying numbers) cost real money. Any
   command that mutates the Twilio account requires explicit human OK in-session.

---

## 5. AuthPak integration

Foundry Clarion does **not** own users, passwords, or sessions.

**On every incoming request** to a Clarion Worker (mirroring `skills-foundry/server/app.ts`):

1. `const claims = await verifyFoundrySession(c.req.raw)` from `@foundry/auth` — reads the
   `fnd_session` cookie and **verifies the JWT statelessly against AuthPak's JWKS**
   (cached; no network call to AuthPak per request). Returns `claims` or `null`.
2. Claims carry `{ sub (user_id), email, email_verified, org_id, org_slug, role, orgs[] }`.
   `role` is the **org** role (`owner`/`admin`/`member`) — not a Clarion role.
3. Set `c.set('user', …)`, `organizationId`, and the resolved **Clarion** role.
4. Silent refresh: the SPA calls `POST https://authpak.foundry-ns.com/api/token/refresh` once
   on 401 before bouncing to `…/login?redirect_uri=`.

**Roles that Clarion cares about** — **RESOLVED: these live in a Clarion table (`cc_members`),
NOT in AuthPak.** The JWT only carries the org role; per-app entitlements are the app's job
(AuthPak SPEC §10). Values (`admin`/`supervisor`/`agent`) stored in `cc_members.clarion_role`:

- `admin` — full provisioning rights inside an org (auto-bootstrapped for AuthPak org owners/admins)
- `supervisor` — can see all queues in the org, listen/monitor/whisper/barge
- `agent` — can log in as an agent, take calls
- (Workspace's own `owner` / `member` roles remain the base layer, seen in the JWT `role` claim)

**Never** implement your own login page, password reset, MFA, or session
issuance. If you find yourself about to, stop.

---

## 6. Data model (starting point — refine as you go)

Clarion tables live in **Clarion's own D1** (`foundry-clarion-db`), all prefixed `cc_`
(for *contact centre* — deliberately name-independent so the prefix survives rebrands).
`org_id` and `user_id` are **TEXT** (AuthPak ids). **No cross-database foreign keys.**
Canonical schema is in `docs/design/foundry-clarion-design.md` §4; highlights:

| Table | Purpose | Key columns |
|---|---|---|
| `cc_org_directory` | Tenant directory, accreted from JWT claims (mirrors Workspace's `org_directory`) | organization_id, name, slug, owner_email, disabled, first/last_seen |
| `cc_members` | **Clarion roles** per user (NOT in the JWT) | organization_id, user_id, clarion_role (admin/supervisor/agent) |
| `cc_agents` | A member enabled as a live agent; **linked to a Workspace resource by email** | id, org_id, user_id, email, workspace_resource_id, twilio_worker_sid, status |
| `cc_agent_skills` | Skills for routing, **snapshotted from Workspace at enable-time** | agent_id, skill_id, proficiency |
| `cc_skills` | Skill catalog per org | id, org_id, name |
| `cc_queues` / `cc_queue_members` | Queues (TaskRouter Workflows) + membership | id, org_id, name, twilio_workflow_sid, strategy / queue_id, agent_id, priority |
| `cc_hunt_groups` | Simple ring groups | id, org_id, name, strategy |
| `cc_ivr_flows` | **Native TwiML interpreter flow graphs** (v1, 2026-07-17 — supersedes the original "Studio flow reference" assumption; see §7) | id, org_id, name, status (draft/active), definition_json, updated_at |
| `cc_numbers` | Provisioned Twilio numbers | id, org_id, e164, twilio_number_sid, assigned_kind, assigned_id |
| `cc_calls` | Call log (reporting) | id, org_id, twilio_call_sid, from_e164, to_e164, queue_id, agent_id, disposition, duration_s, started_at |
| `cc_org_settings` | Per-org recording settings — recording **off by default** (DDL, not app logic); announcement wording per-org | organization_id PK, recording_enabled (DEFAULT 0), announcement_text, updated_at |
| `cc_recordings` | Recording metadata (audio in R2) — org-scoped by column, deliberately (leak test is a direct assertion) | id, organization_id, call_id, twilio_recording_sid, r2_key, duration_s, transcript_r2_key, transcript_status |
| `cc_voicemails` | Voicemail audio metadata from IVR voicemail nodes (audio in R2, mirrors `cc_recordings`); `flow_id` is nullable (`ON DELETE SET NULL`) — best-effort attribution, not a hard link | id, organization_id, flow_id, twilio_call_sid, from_e164, r2_key, duration_s, transcript_r2_key, transcript_status, created_at |
| `cc_audit_log` | Who changed what | id, org_id, user_id, action, meta_json, created_at |

**Workspace linkage is by EMAIL, not FK.** Workspace itself joins logins to `resources` on
`lower(email)`; Clarion does the same. To read `resources`/skills, Clarion **binds
`skills-foundry-db` read-only** (a second D1 binding) and snapshots what routing needs.
Never write to Workspace's DB.

Recordings audio and transcripts belong in **Cloudflare R2**, not D1. D1 stores only
metadata + R2 keys.

---

## 7. Twilio integration

Because we chose the custom-UI path, you'll be working directly with these
Twilio primitives:

- **TaskRouter** — the routing engine. **One shared TaskRouter Workspace** for all Foundry
  orgs, **tenant-tagged** with an `org_id` attribute on every Worker/Workflow/TaskQueue/Task
  (RESOLVED — see design §6.1). Every REST call and routing expression filters on `org_id` via
  a single `scoped(orgId)` wrapper. Workflows = our queues. Workers = our agents. Tasks =
  calls in flight. Isolation is logical + defense-in-depth: agents get **per-worker Access
  Tokens** (Twilio physically prevents cross-worker/cross-org visibility), and cross-tenant
  leak tests guard the server-side supervisor queries.
- **Voice API** — inbound/outbound calls, `<Response>` TwiML, call control.
- **Conversations API** — if/when we add chat, SMS, WhatsApp. Keep the door
  open in the data model but don't build until asked.
- ~~Studio~~ **IVR = Clarion-native TwiML interpreter, NOT Twilio Studio** (decided
  2026-07-17, Steven — supersedes this row's original assumption). A ReactFlow editor
  produces the flow graph JSON (`cc_ivr_flows.definition_json`); our own Worker walks it
  and emits TwiML directly (`server/lib/ivr/interpret.ts`) rather than delegating to a
  Studio Flow. Rationale: less external integration surface, fully testable in-Worker
  under the dry-run rails, fits the "custom UI on raw Twilio, not Flex" philosophy (§2).
  See `docs/superpowers/specs/2026-07-17-ivr-builder-design.md`.
- **Programmable Voice SDK (browser)** — the agent's browser becomes a
  softphone. This is what makes the "custom UI" real.

**Real-time agent state** (available / on-call / wrap-up): **RESOLVED — Durable Object from
the start.** One Durable Object **per org** is the realtime hub: TaskRouter event webhooks →
the org's DO → WebSocket fan-out to that org's connected browsers. A per-org DO also isolates
realtime state by construction (one org's sockets/state never share an instance).

**Call recording (Phase 4, 2026-07-16):** recording starts via the **REST API on the
in-progress call leg** (`POST .../Calls/{sid}/Recordings.json` from the status webhook) —
a considered choice, not an oversight: `<Enqueue>` has no `record` attribute, and the
textbook conference-recording approach needs reservation acceptance, which is Phase 5.
**Phase 5 should migrate to conference recording once reservations land**; at that point
the REST call becomes redundant. Audio lands in R2 (`orgs/{org}/calls/{call}/{rec}.mp3`),
transcripts via Workers AI Whisper behind `AI_DRY_RUN` (see §9).

**IVR builder (v1, 2026-07-17):** flows are built visually (ReactFlow, `src/pages/IvrEditor.tsx`)
and stored as a JSON graph in `cc_ivr_flows.definition_json`; `POST /api/voice/ivr`
(`server/routes/ivr-voice.ts`) walks the graph server-side via the pure
`server/lib/ivr/interpret.ts` core, emitting TwiML node-by-node until it must wait for
caller input (menu/collect) or terminates (route-to-queue/voicemail/hangup). Call state
(collected variables) rides in the Gather/Record action URL as base64-JSON — no
server-side session; a D1/DO-per-CallSid is the documented scale path if that ever proves
insufficient, not built in v1. **Attaching a flow to a real inbound number is Phase 5**
(needs `cc_numbers` + live Twilio) — v1 executes fully under the dry-run rails, exercised
by the in-browser simulator rather than a real call. See
`docs/superpowers/specs/2026-07-17-ivr-builder-design.md`.

**All Twilio credentials** live in the Worker env, never in the frontend.
The browser gets short-lived Twilio Access Tokens minted by Clarion.

---

## 8. Tech stack (CONFIRMED against sibling repos, 2026-07-13)

Mirror Workspace exactly:

- **Language:** TypeScript (`~6.0`)
- **Backend:** **Hono**, served from Cloudflare **Workers with static assets** (not Pages
  Functions) — `server/worker.ts` is the Worker entrypoint, mounts the `server/` app, and
  also exports the `ClarionRealtime` Durable Object class (`wrangler.jsonc` `main`).
- **Frontend:** **React 19 + Vite 8 + Tailwind v4**, `react-router-dom` v7, `@tanstack/react-query` v5
- **DB:** Cloudflare D1 — **own** `foundry-clarion-db` + read-only bind of `skills-foundry-db`
- **Object storage:** Cloudflare R2 (recordings, transcripts)
- **Realtime:** **Durable Objects** (per-org hub — confirmed, §7)
- **Auth SDK:** `@foundry/auth` (vendored tarball `file:vendor/foundry-auth-0.1.0.tgz`)
- **Lint:** oxlint · **Tests:** Vitest (+ Playwright) · **Package manager:** npm
- **Design tokens:** canvas `#f6f7f9`, ink `#0f172a`, muted `#64748b`, hairline `#e6e8ec`,
  accent `#00a3ff`; fonts Space Grotesk (display) / Inter (body) / JetBrains Mono (data)
- **CF account** `5bdc4d7840e522355b86631e6b8fac2b`; zone `foundry-ns.com` = `48950acef28da6dccecea951ff74dce1`

---

## 9. Environment variables (`.env`)

Steven will provide values. Expected keys:

```
# --- Cloudflare ---
CLOUDFLARE_ACCOUNT_ID=   # already in .env
CLOUDFLARE_API_TOKEN=    # already in .env
D1_DATABASE_ID=          # foundry-clarion-db (Clarion's OWN db; created Phase 0)
R2_BUCKET_RECORDINGS=foundry-clarion-recordings
# AI_DRY_RUN lives in wrangler.jsonc vars (default "true"), not .env. It is a COST rail:
# Workers AI has NO local simulator — under `wrangler dev` the AI binding proxies to the
# REAL API and bills the account. Flip to "false" only deliberately, with Steven in-session.
# Workspace's D1 is bound read-only in wrangler config (binding WORKSPACE_DB → skills-foundry-db),
# not via an env var. See design §4.

# --- AuthPak (per-request verify = public JWKS, NO secret) ---
AUTHPAK_BASE_URL=https://authpak.foundry-ns.com   # for login/refresh redirects only
# NO AUTHPAK_SHARED_SECRET / AUTHPAK_COOKIE_NAME — verification is stateless JWKS; cookie is fixed 'fnd_session'.
AUTHPAK_CLIENT_SECRET=   # ONLY if Clarion ever makes server-to-server AuthPak calls (needs a 'clarion' service client first)

# --- Twilio ---
TWILIO_ACCOUNT_SID=      # already in .env
TWILIO_AUTH_TOKEN=       # already in .env (used to validate inbound webhook signatures)
TWILIO_API_KEY_SID=      # NOT YET in .env — needed from Phase 2 to mint Access Tokens
TWILIO_API_KEY_SECRET=   # NOT YET in .env
TWILIO_TASKROUTER_WORKSPACE_SID=   # the ONE shared workspace (created Phase 2, with your OK)
TWILIO_TWIML_APP_SID=              # created Phase 2

# --- App ---
APP_BASE_URL=https://clarion.foundry-ns.com
LOG_LEVEL=info
```

Never commit `.env`. Confirm `.gitignore` before first commit.

---

## 10. Coding conventions

- Match Workspace. If in doubt, open the same file type there and mirror.
- Small files. If a file is over ~300 lines, split it.
- Every route handler has: input validation → auth check → business logic → response. In that order.
- Every table gets a typed accessor in `/src/db/<table>.ts` — no raw SQL scattered through handlers.
- Error responses are JSON with `{ error: { code, message } }`. Never leak stack traces.
- No `any`. If TypeScript is fighting you, ask the human before casting.

---

## 11. Open questions to resolve early (don't block on them, but flag)

- [x] **Clarion roles live in a Clarion table** (`cc_members.clarion_role`), not AuthPak. (2026-07-13)
- [x] **One shared TaskRouter Workspace, tenant-tagged** with logical + defense-in-depth isolation. (2026-07-13)
- [x] **Explicit "enable as agent"** step (creates the Worker on demand; makes billing visible). (2026-07-13)
- [x] **Real-time = Durable Object from the start** (per-org hub). (2026-07-13)
- [x] **Outbound scope: v1 = inbound + click-to-call**, no predictive dialer. (2026-07-13)
- [x] **Local dev session without live AuthPak**: a bounded `DEV_AUTH` exception (local
  `wrangler dev` + tests only). See §12. (2026-07-15)
- [x] **UI look and feel**: vendored snapshot of Workspace's design tokens + `ui.tsx`, own
  `AppShell`, drift test as the guard — not a shared package (Clarion is read-only on
  `skills-foundry`). See §14. (2026-07-15)
- [x] Recording consent / prompts — **decided 2026-07-16 (Steven): recording is off by
  default (`cc_org_settings.recording_enabled DEFAULT 0` — the default is DDL); enabling it
  forces the caller announcement (no separate toggle, silent recording impossible); the
  wording is per-org (`announcement_text`, NULL ⇒ code default).** Pinned by the
  consent-invariant test in `test/voice-route.test.ts`.
- [ ] Mint a **`clarion` AuthPak service client** if/when server-to-server AuthPak calls are needed (change request). Not needed for v0.1.
- [ ] Extract a shared `@foundry/ui` package once Workspace opts in — until then the design
  system stays a vendored snapshot guarded by a drift test (§14).

Log answers back into this file as they land. This file is living.

---

## 12. What NOT to do

- Do not build a login page.
- Do not build a user directory. Users live in Workspace.
- Do not commit in sibling repos.
- Do not put Twilio credentials or AuthPak secrets in the frontend bundle.
- Do not mint your own tokens for anything AuthPak already covers.
- Do not embed Twilio Flex — the custom UI decision is deliberate.
- Do not call the Twilio account-mutating APIs (buy number, create workspace) without explicit in-session confirmation from Steven.
- Do not silently invent APIs you wish the sibling repos had. Write a change request and stop.

**The `DEV_AUTH` exception** (2026-07-15, Phase 3 + UI run — narrows, does not repeal, "Do
not mint your own tokens for anything AuthPak already covers" above): a local-only escape
hatch makes the app drivable without a live AuthPak session, bounded by five rules a future
session must not relitigate or quietly widen:

- `DEV_AUTH` defaults to **off**. Absent or any value but `"true"` ⇒ the dev key resolver
  is never constructed and `verifyFoundrySession` is called exactly as it is today.
- It is honoured **only** under local `wrangler dev` and in tests. It is never set in
  `wrangler.jsonc` production `vars`, never in CI, never in a deployed environment.
- A test asserts that with `DEV_AUTH` unset, a dev-signed token is **rejected**.
- The dev keypair is generated locally and is not an AuthPak key. It cannot produce a
  token any real AuthPak verifier would accept.
- Rail: if `DEV_AUTH` would need to be on anywhere but local `wrangler dev`, the run stops.

Implementation: `server/lib/dev-auth.ts` (in-memory RS256 keypair, issuer
`https://dev.local/authpak`), `server/routes/dev.ts` (`POST /api/dev/session`, 404s unless
`DEV_AUTH === 'true'`). Full rationale: `docs/superpowers/specs/2026-07-15-phase-3-and-ui-design.md` §3.

---

## 13. Starting a session — checklist for the agent

Every new Claude Code session in this repo, in order:

1. Read this file (`CLAUDE.md`) end to end.
2. Read `README.md` and `package.json`.
3. Confirm the sibling repos are accessible for reading.
4. Ask the human: "What are we working on this session?" — get one clear goal.
5. Create/switch to a feature branch.
6. Work.
7. Before ending: update this file with anything learned that a future session would need.

---

## 14. Design system

**Clarion takes its look and feel directly from Foundry Workspace** — the two apps are
tightly coupled and must not visually drift (Steven, 2026-07-15). Mechanism: a **vendored
snapshot**, not a shared package (Clarion is read-only on `skills-foundry`, so a real
`@foundry/ui` package is out of scope until Workspace opts in):

- `src/index.css`'s `@theme` block and `src/components/ui.tsx` (`Card`, `CardHead`,
  `Button`, `Badge`, `Stat`, `Spinner`, `EmptyState`, `Loader`, `Skeleton`, `TableSkeleton`,
  `ErrorState`) are copied **verbatim** from `skills-foundry`, each with a provenance
  header naming source repo, path, and commit.
- `src/components/AppShell.tsx` deliberately does **NOT** port — Workspace's version (641
  lines) is wired into departments, plans, billing, tickets, and a command palette Clarion
  doesn't have. Clarion builds its own shell mirroring Workspace's *structure* (sidebar nav,
  header, `Outlet`) on top of the vendored primitives, not a copy of the file.
- Clarion keeps Workspace's `--accent` CSS-variable indirection but fixes it at `#00a3ff`
  (one app, no departments to theme per-department).
- `test/design-drift.test.ts` is the guard: it re-reads the `skills-foundry` sibling and
  fails when Workspace's copy has moved past the vendored snapshot, so drift is a loud
  failure instead of a slow rot. It skips cleanly when the sibling isn't on disk (CI-safe).
- When Workspace's design system changes, re-vendor deliberately (new provenance commit),
  don't silently hand-edit the vendored files to "fix" a failing drift test.

Full rationale: `docs/superpowers/specs/2026-07-15-phase-3-and-ui-design.md` §4.