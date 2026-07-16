# Foundry Clarion — Plan & Design Report

**Date:** 2026-07-13 · **Author:** Clarion agent (autonomous session) · **Branch:** `feat/clarion-plan-and-design`

You asked me to create the plan and design using my own recommendations, and write up a
report you can review later. This is that report. **Nothing has been built** — these are
three documents (design, plan, this report) on a feature branch, not a line of product
code. No Twilio or Cloudflare account state was changed.

> **UPDATE — decisions locked later on 2026-07-13 (this report is the pre-decision review).**
> Steven walked through the decisions and the app was **renamed Foundry Connect → Foundry Clarion**
> (Amazon Connect conflict). Locked: ① own D1 + read-only Workspace binding, agents = Workspace
> **resources linked by email** with skills snapshotted; ② stateless JWKS auth; ③ Clarion roles in
> `cc_members`; ④ shared TaskRouter workspace, tenant-tagged, **logical + defense-in-depth**;
> ⑤ **Durable Object realtime from the start** (this supersedes the "polling in v0.1" row below);
> ⑥ v1 = inbound + click-to-call. Authoritative state now lives in `docs/design/foundry-clarion-design.md`
> §2/§11 and the updated `CLAUDE.md`. The GitHub repo is now `sjohnston1972/foundry-clarion`.

---

## What I did

1. Read `CLAUDE.md` end-to-end.
2. Read the actual sibling repos (they're cloned as siblings): `authpak/SPEC.md`, the
   vendored `@foundry/auth` package, `skills-foundry` (Workspace) server + all 45 migrations,
   and the `foundry` marketing site's Twilio worker — so the design is grounded in code that
   exists, not in guesses.
3. Wrote **`docs/design/foundry-clarion-design.md`** — the full architecture & design.
4. Wrote **`docs/superpowers/plans/2026-07-13-foundry-clarion-phase-0-1.md`** — a bite-sized,
   test-first, executable plan for Phase 0 (bootstrap) + Phase 1 (auth spine).
5. Wrote this report.

---

## The headline: CLAUDE.md's data/auth model doesn't match reality

Three load-bearing assumptions in `CLAUDE.md` turned out to be wrong against the current
sibling repos. The design corrects them; **two touch "locked" decisions and need your
explicit sign-off** before any code is written.

### 🔴 1. "Shared D1 with Workspace, FK to `users.id`" is not implementable
- AuthPak owns identity in its **own** D1 (`authpak-db`). Workspace has a **separate** D1
  (`skills-foundry-db`) and — critically — **no `users` table at all**; it gets identity from
  the JWT and keeps a `org_directory` table it fills from JWT claims.
- D1 databases are isolated; **you can't FK from one into another.** There is no shared DB
  for Clarion to read users from.
- **My recommendation:** Clarion owns its **own** D1 (`foundry-clarion-db`), mirrors the
  `org_directory` pattern, scopes everything by `organization_id` (TEXT, the AuthPak org id),
  and stores `user_id` (JWT `sub`, TEXT) as a logical reference. This is how AuthPak and
  Workspace already work, and it's the only option that functions given D1 isolation.
- **Decision needed:** confirm Clarion gets its own D1 (this overrides the CLAUDE.md "shared
  D1" locked row). If you genuinely want one physical shared D1, that's a bigger cross-repo
  change and I'd spec it rather than assume it.

### 🔴 2. Auth is stateless JWKS verification, not a server-to-server "verify endpoint"
- Relying parties verify the `fnd_session` JWT locally via AuthPak's JWKS — **no per-request
  call to AuthPak.** The vendored `@foundry/auth` `verifyFoundrySession()` already does this,
  and Workspace uses it verbatim.
- Consequences: cookie is `fnd_session` (fixed, not TBC); AuthPak base is
  `authpak.foundry-ns.com` (CLAUDE.md guessed `auth.foundry-ns.com`); **no
  `AUTHPAK_SHARED_SECRET` is needed** (drop it from the env list); JWT audience is `foundry-ns`.
- This is lower-risk to accept — it's just "use the package the family already ships" — but it
  changes §5 and §9 of CLAUDE.md, so I'm flagging it.

### 🟢 3. Clarion's own roles must live in Clarion (this *resolves* an open question)
- The JWT only carries the org role (`owner`/`admin`/`member`), never
  `clarion:admin`/`supervisor`/`agent`. AuthPak's SPEC is explicit that per-app entitlements
  belong to the consuming app.
- So Clarion roles live in a Clarion table (`cc_members`). This closes **CLAUDE.md open
  question §11 Q1** — no discussion with the AuthPak agent needed. My design bootstraps any org
  `owner`/`admin` as a Clarion `admin` on first visit so an org can always administer Clarion.

---

## Recommendations I made on the other open questions (CLAUDE.md §11)

You told me to use my own judgement; here's what I chose and why. All are reversible and
none block Phases 0–1.

| Question | My recommendation | Why |
|---|---|---|
| TaskRouter: one Workspace per org vs shared? | **One shared Workspace, tenant-tagged** with an `organization_id` attribute on every Worker/Workflow/Task. | Per-org Workspaces are heavyweight and multiply ops/limits for no real isolation gain at this scale. Isolation becomes a disciplined filter (+ tests). Escape hatch: migrate a single tenant to its own Workspace later if ever needed. |
| Auto-create TaskRouter Worker on queue assignment? | **No — explicit "enable as agent"** step. | Makes billing visible; matches CLAUDE.md's own lean. |
| Realtime agent state: Durable Object vs polling? | ~~Polling in v0.1, DO in v0.2~~ → **DECIDED: Durable Object from the start** (per-org hub). | Steven chose DO from day one; a per-org DO also isolates realtime state by construction, reinforcing the no-bleed requirement. |
| Outbound scope for v1? | **Inbound + click-to-call; no predictive dialer.** | Click-to-call is nearly free once the inbound softphone works; a real dialer is a separate build. |
| Recording consent? | Code exposes a per-org toggle + per-number announcement; **defaults/jurisdiction are your product call.** | It's a legal/product decision, not a code one (your call per CLAUDE.md). |

---

## Things that need to happen before Phase 2 (not before Phases 0–1)

- **Twilio API Key + Secret** (`TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`) are **not in
  `.env`** yet — needed to mint browser Access Tokens. (`.env` currently has account SID +
  auth token only.)
- **Twilio account mutations** — creating the TaskRouter Workspace/Workflows, buying a number,
  creating a Studio flow — each needs an explicit in-session "go" from you (CLAUDE.md §4.5/§12).
  The plan isolates these behind a `provisioning/` module + `DRY_RUN` so everything up to the
  mutating call is testable without touching the account.
- **Server-to-server AuthPak calls** (if we ever need them, e.g. cron member-list reconcile):
  AuthPak already supports HMAC service calls keyed by a service client id (Workspace uses
  `foundry`). Clarion should get its **own** `clarion` service client — that's an AuthPak-side
  change, so it'd be a change-request, not something I invent. Deferred; v0.1's browser-driven
  member list doesn't need it.

---

## What Phase 0–1 delivers (the executable plan)

Nine test-first tasks taking Clarion from empty repo to a working, tested identity spine:
scaffold → own D1 → health check → base tables (`cc_org_directory`, `cc_members`,
`cc_audit_log`) → typed accessors → Clarion-role resolution with owner→admin bootstrap →
AuthPak session gate + `/api/auth-status` + `/api/me` → minimal SPA gate (signed-out /
no-access / app) → end-to-end local verification. Every task is red-test → implement →
green-test → commit. No Twilio, no account mutations — safe to execute whenever you approve
the design.

---

## What I recommend you do next

1. **Skim the design doc §2 and this report's 🔴 items** — the D1-ownership and JWKS-auth
   corrections are the only things that need a real decision. Everything else is a default I
   picked that you can veto later.
2. **Tell me if the "own D1" recommendation is approved.** If yes, I'll also propose the
   specific edits to bring `CLAUDE.md` §2/§5/§6/§9 in line (I did **not** unilaterally rewrite
   your locked decisions — per CLAUDE.md I raise them with you first).
3. **When you want to build**, say so and pick subagent-driven vs inline execution for the
   Phase 0–1 plan. Phase 0 Task 2 (`wrangler d1 create`) is the first — and only — account
   touch in Phases 0–1, and it's free; I'll pause there for your OK if you prefer zero account
   changes until then.

---

## Files produced (on `feat/clarion-plan-and-design`, uncommitted)

- `docs/design/foundry-clarion-design.md`
- `docs/superpowers/plans/2026-07-13-foundry-clarion-phase-0-1.md`
- `docs/reports/2026-07-13-plan-and-design-report.md` (this file)
