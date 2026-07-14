# Foundry Clarion — PROGRESS.md

Handoff log for the autonomous Phase 0–1 run. See `PLAN.md` for the steps.

**Rules (from `~/.claude/CLAUDE.md` → "Autonomous run discipline"):** re-read `PLAN.md` and
this file first every turn; do one step per turn; commit each change; append a timestamped
entry below when a step is verified done; when all 10 steps are complete create an empty
`DONE` file and stop; if the plan is ambiguous, write questions under **Blockers** and create
`DONE` rather than guessing.

## Status

Step 5 complete. Next: **Step 6 — Auth gate + identity endpoints (wire verifyFoundrySession into server/app.ts, add /api/auth-status + server/routes/me.ts + test/app-auth.test.ts).**

## Log

<!-- Append one line per completed step, e.g.:
- 2026-07-14T09:00Z — Step 1 done: scaffold + npm install (0 exit). commit abc1234
-->
- 2026-07-14T15:24Z — Step 1 done: scaffolded package.json, wrangler.jsonc, tsconfig (app/node/server), vite/vitest configs; copied vendor/foundry-auth-0.1.0.tgz. `npm install` exited 0 (128 packages). Pinned `wrangler` to `4.104.0` (Workspace's resolved version) to dodge the `@cloudflare/workers-types` v5 peer conflict that wrangler 4.110 introduced. `@foundry/auth` resolves via ESM `import()` (it's ESM-only with an exports map, so the plan's `require()` form errors ERR_PACKAGE_PATH_NOT_EXPORTED, but `import()` exposes `verifyFoundrySession` — the form the app actually uses). commit f53ed3e
- 2026-07-14T15:27Z — Step 2 done: `migrations/0001_init.sql` (cc_org_directory, cc_members with clarion_role CHECK, cc_audit_log; org_id/user_id TEXT, no cross-DB FKs) + `test/migration.test.ts`. Verified: `d1:migrate:local` applied 0001_init (✅, 7 commands executed); `vitest run test/migration.test.ts` → 1 passed. commit 54d7bfa
- 2026-07-14T16:05Z — Step 3 done: `server/types.ts`, `server/lib/http.ts`, `server/routes/health.ts`, `server/app.ts` (health mounted pre-gate), `functions/api/[[route]].ts`, `test/health.test.ts`. Verified: `vitest run test/health.test.ts` → 1 passed (200 + {status:'healthy', database:'connected'}). Deviation from plan's verbatim code: `http.ts` uses `status as never` (Workspace's Hono status-code convention) so `typecheck:server` stays clean — the plan's `status: number` failed against Hono's `ContentfulStatusCode`. commit d206abb
- 2026-07-14T16:06Z — Step 4 done: `server/db/members.ts` (getClarionRole/setClarionRole + ClarionRole type, upsert via ON CONFLICT) and `server/db/directory.ts` (touchOrgDirectory upsert → {disabled}). Verified: `vitest run test/db.test.ts` → 2 passed; `typecheck:server` clean. commit 9389fa7
- 2026-07-14T16:08Z — Step 5 done: `server/lib/auth.ts` — `resolveClarionRole(db, claims)` (stored cc_members role → else bootstrap AuthPak org owner/admin to Clarion 'admin' → else null) + `requireClarionRole(min)` Hono middleware (403 clarion_no_access / clarion_forbidden by RANK). Confirmed `FoundryClaims` (sub, org_id?, role?) exists in the vendored `@foundry/auth` types before using it. Verified: `vitest run test/auth.test.ts` → 3 passed (stored-role, owner-bootstrap, member-null); `typecheck:server` clean. commit cdfa7d6

## Blockers

<!-- If the plan is ambiguous or a step can't be verified, write the question here, then create DONE and stop. -->
