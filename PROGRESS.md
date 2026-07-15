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

## Blockers

<!-- If the plan is ambiguous or a step can't be verified, write the question here, end the run, and stop. -->
