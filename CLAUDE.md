# Foundry Connect — CLAUDE.md

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

**Foundry Connect** is a Contact Centre as a Service (CCaaS) product that
lives inside the **Foundry** SaaS platform.

- **Public URL:** `connect.foundry-ns.com`
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
| Multi-agent workflow | **One Claude Code session per repo.** Three sessions total: `connect`, `authpak`, `skills-foundry`. | Clean blast radius per agent; matches Steven's `multiclaude` pattern; forces explicit cross-repo contracts. |
| Data storage | **Shared Cloudflare D1 database with Workspace.** Connect reads from Workspace's `users`, `orgs`, `roles` tables directly. Connect owns its own tables (queues, agents, calls, etc.) in the same DB. | Avoids a users-sync problem; queue membership is a real FK to `users.id`; single source of truth for tenancy. |
| Auth | **AuthPak session cookie, scoped to `.foundry-ns.com`.** Connect validates the session server-side on every request; no separate login flow. | User goes to `connect.foundry-ns.com` and is already signed in if they're signed into Workspace. |
| Tenancy | **Org-scoped, same as Workspace.** Every Connect resource has an `org_id`. | Matches Workspace's mental model. |

These are locked. If a change is genuinely needed, raise it with the human
before writing code.

---

## 3. Repo map — you are here

```
┌─────────────────────────────────────────────────────────────┐
│                    foundry-ns.com                            │
│                                                              │
│   ┌──────────────┐   ┌─────────────┐   ┌────────────────┐    │
│   │  workspace   │   │   authpak   │   │    connect     │    │
│   │  (parent)    │──▶│  (auth)     │◀──│  (THIS REPO)   │    │
│   │ skills-      │   │             │   │                │    │
│   │ foundry repo │   │             │   │                │    │
│   └──────────────┘   └─────────────┘   └────────────────┘    │
│          │                                     │             │
│          └────────── shared D1 ────────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

| Repo | GitHub | Your access from this session |
|---|---|---|
| `foundry-connect` (this one) | `github.com/sjohnston1972/foundry-connect` | **Read + write** |
| `authpak` | `github.com/sjohnston1972/authpak` | **Read only.** If Connect needs an AuthPak change, write a short spec in `/docs/change-requests/authpak-<slug>.md` and stop. The AuthPak session will pick it up. |
| `skills-foundry` (Workspace) | `github.com/sjohnston1972/skills-foundry` | **Read only.** Same rule — spec change requests under `/docs/change-requests/workspace-<slug>.md`. |

**Why this matters:** three agents will be running in parallel. If each one
edits whatever it needs, they'll trample each other and produce merge chaos.
The change-request pattern makes cross-repo work explicit and traceable.

---

## 4. Multi-agent contract

You are the **Connect agent**. Rules:

1. **Never `git commit` or `git push` in `authpak/` or `skills-foundry/`.**
   You may read them (they should be cloned as siblings, or as git submodules
   under `/vendor/` — confirm with the human on first session).
2. **Do not assume APIs exist just because they'd be convenient.** Before
   calling `authpak.verifySession()` or a Workspace endpoint, open the
   referenced repo and check the actual signature. If it doesn't exist,
   write a change request (see §3) instead of stubbing.
3. **Contract changes are two-sided.** If you change a Connect API that
   Workspace consumes, update `/docs/api-contracts/` in Connect *and* file
   a change request for Workspace.
4. **Feature branches, not `main`.** Branch name pattern: `feat/<area>-<short-desc>`,
   e.g. `feat/queues-provisioning`. Never push to `main` directly.
5. **Confirm before touching Twilio account state.** Twilio side-effects
   (creating TaskRouter Workspaces, buying numbers) cost real money. Any
   command that mutates the Twilio account requires explicit human OK in-session.

---

## 5. AuthPak integration

Foundry Connect does **not** own users, passwords, or sessions.

**On every incoming request** to a Connect Worker:

1. Read the AuthPak session cookie from the `Cookie` header (name TBC — check
   `authpak/README.md` and use whatever it defines; do not guess).
2. Call AuthPak's session-verify endpoint (again — confirm the actual path
   from the AuthPak repo, don't invent one).
3. Receive back: `{ user_id, org_id, roles: [...] }`.
4. Attach that to `ctx.user` and use it for all subsequent authorization.

**Roles that Connect cares about** (Connect-scoped, not global):

- `connect:admin` — full provisioning rights inside an org
- `connect:supervisor` — can see all queues in the org, listen/monitor
- `connect:agent` — can log in as an agent, take calls
- (Workspace's own `owner` / `member` roles remain the base layer)

Whether these roles live in AuthPak's DB or in a Connect-owned table is an
**open question — see §11.** For now, model them in Connect and revisit.

**Never** implement your own login page, password reset, MFA, or session
issuance. If you find yourself about to, stop.

---

## 6. Data model (starting point — refine as you go)

Connect adds these tables to the shared D1 database. Prefix all Connect
tables with `cc_` to keep them separate from Workspace's tables.

| Table | Purpose | Key columns |
|---|---|---|
| `cc_queues` | Call queues (inbound routing targets) | id, org_id, name, twilio_workflow_sid, strategy |
| `cc_hunt_groups` | Simpler ring-group targets | id, org_id, name, strategy (ring-all/round-robin) |
| `cc_agents` | A Workspace user acting as a CC agent | id, org_id, user_id (FK → workspace users), twilio_worker_sid, status |
| `cc_agent_skills` | Skill assignments for skills-based routing | agent_id, skill_id, proficiency |
| `cc_skills` | Skill catalog per org | id, org_id, name |
| `cc_queue_members` | Which agents are in which queues | queue_id, agent_id, priority |
| `cc_ivr_flows` | Studio flow references / definitions | id, org_id, name, twilio_flow_sid, definition_json |
| `cc_numbers` | Provisioned Twilio phone numbers | id, org_id, e164, twilio_number_sid, assigned_to (queue/flow) |
| `cc_calls` | Call log (for reporting) | id, org_id, twilio_call_sid, from, to, queue_id, agent_id, disposition, duration, started_at |
| `cc_recordings` | Recording metadata (audio in R2) | id, call_id, r2_key, duration, transcript_r2_key |

**Foreign keys into Workspace tables** — confirm the actual table/column names
by reading the Workspace repo before writing migrations. Likely candidates:
`users(id)`, `orgs(id)`, but do not guess.

Recordings audio and transcripts belong in **Cloudflare R2**, not D1. D1 stores
only metadata + R2 keys.

---

## 7. Twilio integration

Because we chose the custom-UI path, you'll be working directly with these
Twilio primitives:

- **TaskRouter** — the routing engine. One TaskRouter Workspace per Foundry
  org (or one shared with tenant tags — decide early and document). Workflows
  = our queues. Workers = our agents. Tasks = calls in flight.
- **Voice API** — inbound/outbound calls, `<Response>` TwiML, call control.
- **Conversations API** — if/when we add chat, SMS, WhatsApp. Keep the door
  open in the data model but don't build until asked.
- **Studio** — for IVR flow definitions. Store the Flow SID; consider
  round-tripping the JSON definition through our own UI.
- **Programmable Voice SDK (browser)** — the agent's browser becomes a
  softphone. This is what makes the "custom UI" real.

**Real-time agent state** (available / on-call / wrap-up) will need a
persistent connection. Options: TaskRouter's event webhooks → Durable Object
→ WebSocket to the browser. Confirm with the human before committing to
Durable Objects — they change the deployment shape.

**All Twilio credentials** live in the Worker env, never in the frontend.
The browser gets short-lived Twilio Access Tokens minted by Connect.

---

## 8. Tech stack (confirm against sibling repos on first session)

Assumed to match Workspace unless you find otherwise:

- **Language:** TypeScript
- **Backend:** Cloudflare Workers, likely Hono (confirm)
- **Frontend:** React (confirm framework — Vite? Next on Pages? React Router?)
- **DB:** Cloudflare D1 (shared with Workspace)
- **Object storage:** Cloudflare R2 (recordings, transcripts)
- **Realtime:** Durable Objects (tentative — see §7)
- **Package manager:** whatever Workspace uses — mirror it exactly

**First-session checklist:**

1. Clone/link the sibling repos so you can read them.
2. Open `workspace`'s `package.json` and mirror TS/lint/prettier config.
3. Open `authpak`'s README and note the actual session-verification API.
4. Update this file's §5 and §8 with what you found, then commit.

---

## 9. Environment variables (`.env`)

Steven will provide values. Expected keys:

```
# --- Cloudflare ---
CF_ACCOUNT_ID=
CF_API_TOKEN=
D1_DATABASE_ID=          # same DB as Workspace
R2_BUCKET_RECORDINGS=

# --- AuthPak ---
AUTHPAK_BASE_URL=        # e.g. https://auth.foundry-ns.com
AUTHPAK_SHARED_SECRET=   # for server-to-server session verify (confirm mechanism)
AUTHPAK_COOKIE_NAME=     # confirm from authpak repo

# --- Workspace ---
WORKSPACE_BASE_URL=      # https://workspace.foundry-ns.com
WORKSPACE_API_TOKEN=     # if any server-to-server calls needed

# --- Twilio ---
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_TASKROUTER_WORKSPACE_SID=
TWILIO_TWIML_APP_SID=

# --- App ---
APP_BASE_URL=https://connect.foundry-ns.com
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

- [ ] Do Connect roles (`connect:admin`, `connect:supervisor`, `connect:agent`) live in AuthPak or in a Connect-owned table? Discuss with the AuthPak agent.
- [ ] One Twilio TaskRouter Workspace per Foundry org, or one shared Workspace with per-tenant attributes? Cost + isolation tradeoff.
- [ ] When a Workspace user is assigned to a Connect queue, do we auto-create their TaskRouter Worker, or require an explicit "enable as agent" step? (Recommend explicit — makes billing visible.)
- [ ] Recording consent / prompts — jurisdiction rules are a product decision, not a code decision. Human owns this.
- [ ] Real-time agent state: Durable Object vs. polling. Deferred until v0.2.
- [ ] Outbound dialer scope — is v1 receive-only, or click-to-call from day one?

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