# Foundry Clarion — Phase 0–1 status (auth spine, local-verified)

**Status:** complete, all verification local. No Cloudflare account change and no Twilio.
Branch: `feat/clarion-plan-and-design`. See `PLAN.md` / `PROGRESS.md` for the step-by-step
handoff log, and `docs/superpowers/plans/2026-07-13-foundry-clarion-phase-0-1.md` for the
full detailed plan.

## What Phase 0–1 delivers

The bootstrap + identity/tenancy spine every later phase builds on:

- **Scaffold** — Pages + Hono (Pages Functions) + Vite/React 19 + Tailwind v4 + own D1,
  toolchain mirrored from Workspace. `@foundry/auth` vendored (`vendor/foundry-auth-0.1.0.tgz`).
  `wrangler` pinned to `4.104.0` to avoid the `@cloudflare/workers-types` v5 peer conflict.
- **Migration `0001_init`** — Clarion-owned tables `cc_org_directory`, `cc_members`
  (`clarion_role` CHECK: admin/supervisor/agent), `cc_audit_log`. `organization_id` /
  `user_id` are TEXT (AuthPak ids); no cross-database FKs.
- **Health** — `GET /api/health` → `{ success, status: 'healthy', database: 'connected' }`,
  mounted before any auth gate.
- **Typed DB accessors** — `server/db/members.ts` (`getClarionRole` / `setClarionRole`) and
  `server/db/directory.ts` (`touchOrgDirectory`). No raw SQL in handlers.
- **Role resolution + guard** — `resolveClarionRole(db, claims)` (stored `cc_members` role;
  bootstraps an AuthPak org owner/admin with no row to Clarion `admin`; else `null`) and
  `requireClarionRole(min)` middleware. Clarion roles live in Clarion's table, not the JWT.
- **AuthPak session gate** — `verifyFoundrySession` wired into `server/app.ts` (stateless
  JWKS, no per-request AuthPak call); public `GET /api/auth-status` (never 401s) drives the
  SPA gate; `GET /api/me` behind the gate. When `AUTH_ENFORCE=true`, unauthenticated XHR
  gets 401 and HTML navigations 302 to `authpak.foundry-ns.com/login?redirect_uri=`.
- **CI** — `.github/workflows/ci.yml` (lint → typecheck:server → build → test, Node 20).
- **SPA gate** — `src/lib/session.ts` (`classifyGate` → signed-out / no-access / app) +
  a minimal shell (`index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`) rendering
  the three states with the design tokens; signed-out links to AuthPak login.

## Verification (all local)

Full local gate green: `npm run d1:migrate:local && npx vitest run && npm run build &&
npm run lint` — all exit 0. Test suite: 5 files, 10 tests passing (migration, health, db,
auth, app-auth, session). `typecheck:server` clean.

Not yet verified (needs live infra): a real signed-in flow requires an `fnd_session` cookie
from a deployed `authpak.foundry-ns.com`; confirmed once AuthPak is deployed. The SPA
signed-out gate (AuthPak login link) is drivable locally.

## STOP boundary — Phase 2 needs a Twilio touch

Phase 2+ (enable-as-agent, minting Twilio Access Tokens, creating the shared TaskRouter
Workspace) requires `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` (not yet in `.env`) and
Twilio account mutations that need Steven's explicit in-session "go". Also deferred to deploy
time: the real `wrangler d1 create foundry-clarion-db` (Phase 0–1 used local D1 only, so
`wrangler.jsonc:database_id` is still the `REPLACE_AFTER_TASK_2` placeholder). Do not proceed
past this boundary autonomously.
