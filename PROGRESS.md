# Foundry Clarion — PROGRESS.md

Handoff log for the **Pages → Workers migration + Durable Object proof** run.
See `PLAN.md` for the steps and the bail-out rail.

**Rules:** `~/.claude/CLAUDE.md` → "Autonomous runs and interactive planning". Re-read `PLAN.md`
and this file first every turn; one step per turn; commit each change; verify before claiming a
step done; append a timestamped line below. Never rewrite history in this file — append only.
If the plan is ambiguous, write the question under **Blockers**, end the run, and stop.

## Goal

Get `ClarionRealtime` working for real by moving Clarion from Pages Functions to
Workers-with-static-assets, proven by a live WebSocket handshake (HTTP 101) under
`wrangler dev`. Nothing else. Queues are the *next* run.

## Starting state (armed 2026-07-15 by Steven + interactive session)

- Branch `feat/realtime-workers-migration`, cut from `main`.
- `main` was fast-forwarded to Phase 2 (`1f8626a`) in the arming session — it was previously an
  empty "Initial commit" with all 53 commits stranded on `feat/clarion-phase-2-agents-realtime`.
  `main` is **not pushed**; Steven owns that decision (CLAUDE.md §4).
- Phase 2 run state archived to `docs/runs/2026-07-14-phase-2-agents-realtime/`; its `DONE` cleared.
- Phase 2 gate was green at archive time: vitest 35/35, typecheck / lint / build clean.
- Known blocker this run exists to kill: Pages Functions bundler drops the `ClarionRealtime`
  export → `wrangler pages dev` won't start with the `durable_objects` binding. Evidence in
  `docs/phase-2-status.md`.

## Decisions carried in (do not re-open)

- **Stack:** Workers + static assets, superseding CLAUDE.md §8's "Pages Functions". Approved by
  Steven 2026-07-15, on the finding that §8's mirror-Workspace rationale predates any Foundry
  repo needing a Durable Object — `skills-foundry` still has none. Step 9 records this.
- **Scope:** migration only. Queues explicitly deferred to the next run.
- **Role gate:** keep the per-route `requireClarionRole(...)` gates as-is. The guard test goes
  with the queue run.
- **Rejected alternatives** (do not attempt as a fallback): Pages `_worker.js` advanced mode;
  separate Worker + `script_name` binding. If Workers+assets fails, revert and report — the
  bail-out rail in `PLAN.md` is binding.

## Log

<!-- Append one line per verified step, e.g.:
- 2026-07-15T21:00Z — Step 2 done: server/worker.ts exports app + ClarionRealtime. vitest 35/35 PASS, typecheck clean. commit abc1234
-->

- 2026-07-15T13:00Z — Step 1 done (baseline + reproduce, no code changed). Full local gate:
  `npm run d1:migrate:local` → "No migrations to apply!"; `npx vitest run` → 14 files / 35 tests
  PASS; `npm run typecheck:server` → clean (no output); `npm run lint` (`npx oxlint`) → clean (no
  output); `npm run build` → `tsc -b && vite build` succeeded, `dist/` emitted. All five exit 0.
  Then ran `npm run pages:dev` and captured the DO bundler error verbatim:

  ```
  X [ERROR] Your Worker depends on the following Durable Objects, which are not exported in your entrypoint file: ClarionRealtime.

    You should export these objects from your entrypoint, .wrangler\tmp\pages-hsJUlh\functionsWorker-0.7154761055656534.mjs.
  ```

  Matches PLAN.md Step 1's expected text exactly. Confirms the blocker this run exists to kill.
  Committed (evidence only, no code changes).

- 2026-07-15T13:15Z — Step 2 done: added `server/worker.ts` (`export default createApp()` +
  `export { ClarionRealtime } from './realtime/clarion-realtime'`), `functions/api/[[route]].ts`
  left untouched. `npx vitest run` → 14 files / 35 tests PASS; `npm run typecheck:server` →
  clean. `npm run pages:dev` re-run and still fails with the identical Step 1 error text
  (`ClarionRealtime` not exported in `functionsWorker-*.mjs`), confirming nothing else moved.
  commit 07f4694.

- 2026-07-15T13:30Z — Step 3 done: `wrangler.jsonc` switched to Workers + static assets.
  Removed `pages_build_output_dir`; added `"main": "server/worker.ts"` and an `assets` block
  (`directory: "./dist"`, `not_found_handling: "single-page-application"`,
  `run_worker_first: ["/api/*"]`) so `/api/*` always reaches the Worker before the SPA fallback
  can swallow it (to be proven live in Step 6). `d1_databases` (including the `REPLACE_*`
  placeholders), `durable_objects`, `migrations`, `compatibility_date`, `compatibility_flags`,
  and `vars` left byte-for-byte untouched — confirmed via `git diff wrangler.jsonc`.
  `npm run typecheck:server` → clean; `npx vitest run` → 14 files / 35 tests PASS. Config
  validation: `wrangler dev --dry-run` is not a supported flag combo in wrangler 4.104.0
  ("Unknown arguments: dry-run, dryRun"), so validated with `npx wrangler dev` under a 15s
  timeout instead — it started cleanly with `Ready on http://127.0.0.1:8787`, no config error,
  no missing-DO-export error, and correctly showed `env.REALTIME (ClarionRealtime)` as a local
  Durable Object binding (`durable_objects` no longer needs `functions/api/[[route]].ts` to
  re-export it). commit fad0627.

## Blockers

<!-- If the plan is ambiguous or a step can't be verified, write the question here, end the run, and stop. -->
