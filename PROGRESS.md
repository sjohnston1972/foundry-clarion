# Foundry Clarion — PROGRESS.md

Handoff log for the autonomous Phase 0–1 run. See `PLAN.md` for the steps.

**Rules (from `~/.claude/CLAUDE.md` → "Autonomous run discipline"):** re-read `PLAN.md` and
this file first every turn; do one step per turn; commit each change; append a timestamped
entry below when a step is verified done; when all 10 steps are complete create an empty
`DONE` file and stop; if the plan is ambiguous, write questions under **Blockers** and create
`DONE` rather than guessing.

## Status

**All 10 steps complete.** Phase 0–1 (bootstrap + auth spine) done and local-verified; `DONE` created; run stops here at the Phase 2 (Twilio) boundary.

## Log

<!-- Append one line per completed step, e.g.:
- 2026-07-14T09:00Z — Step 1 done: scaffold + npm install (0 exit). commit abc1234
-->
- 2026-07-14T15:24Z — Step 1 done: scaffolded package.json, wrangler.jsonc, tsconfig (app/node/server), vite/vitest configs; copied vendor/foundry-auth-0.1.0.tgz. `npm install` exited 0 (128 packages). Pinned `wrangler` to `4.104.0` (Workspace's resolved version) to dodge the `@cloudflare/workers-types` v5 peer conflict that wrangler 4.110 introduced. `@foundry/auth` resolves via ESM `import()` (it's ESM-only with an exports map, so the plan's `require()` form errors ERR_PACKAGE_PATH_NOT_EXPORTED, but `import()` exposes `verifyFoundrySession` — the form the app actually uses). commit f53ed3e
- 2026-07-14T15:27Z — Step 2 done: `migrations/0001_init.sql` (cc_org_directory, cc_members with clarion_role CHECK, cc_audit_log; org_id/user_id TEXT, no cross-DB FKs) + `test/migration.test.ts`. Verified: `d1:migrate:local` applied 0001_init (✅, 7 commands executed); `vitest run test/migration.test.ts` → 1 passed. commit 54d7bfa
- 2026-07-14T16:05Z — Step 3 done: `server/types.ts`, `server/lib/http.ts`, `server/routes/health.ts`, `server/app.ts` (health mounted pre-gate), `functions/api/[[route]].ts`, `test/health.test.ts`. Verified: `vitest run test/health.test.ts` → 1 passed (200 + {status:'healthy', database:'connected'}). Deviation from plan's verbatim code: `http.ts` uses `status as never` (Workspace's Hono status-code convention) so `typecheck:server` stays clean — the plan's `status: number` failed against Hono's `ContentfulStatusCode`. commit d206abb
- 2026-07-14T16:06Z — Step 4 done: `server/db/members.ts` (getClarionRole/setClarionRole + ClarionRole type, upsert via ON CONFLICT) and `server/db/directory.ts` (touchOrgDirectory upsert → {disabled}). Verified: `vitest run test/db.test.ts` → 2 passed; `typecheck:server` clean. commit 9389fa7
- 2026-07-14T16:08Z — Step 5 done: `server/lib/auth.ts` — `resolveClarionRole(db, claims)` (stored cc_members role → else bootstrap AuthPak org owner/admin to Clarion 'admin' → else null) + `requireClarionRole(min)` Hono middleware (403 clarion_no_access / clarion_forbidden by RANK). Confirmed `FoundryClaims` (sub, org_id?, role?) exists in the vendored `@foundry/auth` types before using it. Verified: `vitest run test/auth.test.ts` → 3 passed (stored-role, owner-bootstrap, member-null); `typecheck:server` clean. commit cdfa7d6
- 2026-07-14T16:10Z — Step 6 done: wired `verifyFoundrySession` into `server/app.ts` — public `GET /api/auth-status` (never 401s) + enforce middleware on `/api/*` (touches cc_org_directory, resolves clarionRole, sets user/organizationId/clarionRole; AUTH_ENFORCE=true → 401 XHR / 302 HTML→AuthPak login) + `server/routes/me.ts` (`GET /api/me`). Note: PLAN.md's verify text says `connectRole` (stale pre-rename prose); the code + detailed-plan test use `clarionRole` — followed the code. Verified: `vitest run test/app-auth.test.ts` → 3 passed (public logged-out, /api/me 401 unauth, /api/me 200 clarionRole:admin owner-bootstrap); full suite 10/10; `typecheck:server` clean. commit fac0b23
- 2026-07-14T16:12Z — Step 7 done: `.github/workflows/ci.yml` mirroring skills-foundry (push→main + PR→any branch; npm ci → lint → typecheck:server → build → test on Node 20). Verified locally with the Step-7 gate: `vitest run` → 10/10 passed, `typecheck:server` clean, `lint` (oxlint) clean — all exit 0. (CI's `build` step will go green once Steps 8–9 add the SPA; not part of the Step-7 local gate.) commit ed33e99
- 2026-07-14T16:14Z — Step 8 done: `src/lib/session.ts` — `AuthStatus` type, `classifyGate(status)` → 'signed-out' | 'no-access' | 'app', `fetchAuthStatus()` (GET /api/auth-status, credentials:'include'). Verified: `vitest run test/session.test.ts` → 3 passed (signed-out, no-access, app). commit 6a24d9f
- 2026-07-14T16:16Z — Step 9 done: `index.html` (title + Google fonts), `src/index.css` (`@import 'tailwindcss'` + `@theme` design tokens: canvas/ink/muted/line/accent + display/sans/mono fonts), `src/main.tsx` (StrictMode + createRoot, minimal — no Workspace-only providers), `src/App.tsx` (fetchAuthStatus → classifyGate → renders signed-out / no-access / app + loading + error; signed-out links to authpak.foundry-ns.com/login?redirect_uri=<current>). Fixed `React.ReactNode` → imported `ReactNode` (verbatimModuleSyntax has no auto React namespace). Verified: `npm run build` (tsc -b && vite build) exit 0, `dist/index.html` present (805 B); `lint` clean. commit 8db0bfa
- 2026-07-14T16:19Z — Step 10 done (capstone): `docs/phase-0-1-status.md` summarizing Phase 0–1 deliverables + the Phase 2 STOP boundary. Verified full local gate all exit 0: `d1:migrate:local` (no migrations to apply — 0001_init already applied in Step 2), `vitest run` (6 files / 13 tests passed), `npm run build` (tsc -b && vite build, dist produced), `npm run lint` (oxlint clean). commit 2721f6f. **All 10 PLAN.md steps complete — created empty `DONE`; stopping at the Phase 2 (Twilio) boundary.**

## Blockers

<!-- If the plan is ambiguous or a step can't be verified, write the question here, then create DONE and stop. -->
