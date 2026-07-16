# Foundry Clarion — PLAN.md (Run: Pages → Workers migration + Durable Object proof)

Autonomous-run work order. One small, commit-able step per turn, each ending in a check you
can actually run. Append a timestamped line to `PROGRESS.md` after each verified step.

**Goal of this run, in one sentence:** get the `ClarionRealtime` Durable Object working for
real by moving Clarion from Cloudflare Pages Functions to Workers-with-static-assets, and
prove it with a live WebSocket handshake — nothing else.

**Why this run exists:** Phase 2 delivered the realtime spine but the Pages Functions bundler
tree-shakes the `ClarionRealtime` export out of `functionsWorker-*.mjs`, so `wrangler pages dev`
refuses to start with the `durable_objects` binding present (full evidence in
`docs/phase-2-status.md`). The DO is therefore verified at unit level only. Workers with static
assets exports Durable Objects natively, which removes the problem at its root rather than
working around it.

**Decision authority:** Steven approved this stack change in-session on 2026-07-15, on the
finding that CLAUDE.md §8's "Pages Functions, mirror Workspace" was chosen when no Foundry repo
used Durable Objects — Workspace (`skills-foundry`) still has none, so the parity argument
doesn't cover Clarion's case. Step 9 records the decision. **Do not re-open it; do not extend it.**

---

## Invariants (apply to EVERY step)

- Package manager **npm**. No `any`. `organization_id` / `user_id` are TEXT.
- Success envelope `{ success, data }`; errors `{ error: { code, message } }`.
- Branch **`feat/realtime-workers-migration`** only. **Never commit to `main`.**
- **Never write to `WORKSPACE_DB`** (read-only bind). Every query filters by `organization_id`.
- Secrets never reach the frontend bundle.
- `TWILIO_DRY_RUN` stays `"true"`. **Do not flip it. No Twilio account mutation of any kind.**
- **No Cloudflare account change. Do not run `wrangler deploy` or `wrangler pages deploy`.**
  This run is local-only: `wrangler dev` is allowed, deploying is not.
- Do not fill in the `REPLACE_*` `database_id` placeholders. Local dev treats them as opaque
  keys (proven in Phase 2) and filling them is a Phase 3 deploy task, not this run's job.

## Bail-out rail — read this before you start

This run changes how the app is hosted. A half-migrated repo is a bad thing to wake up to.

- Steps 2–6 are the migration. If any of them cannot go **green after one honest attempt**,
  **stop**: `git revert` this run's migration commits (or `git reset --hard` to the commit from
  Step 1 if nothing else has landed), confirm the full local gate is green again, write what you
  found under **Blockers** in `PROGRESS.md`, and end the run per the protocol.
- Do not try a second architecture. Do not fall back to `_worker.js` advanced mode or a separate
  Worker + `script_name` binding on your own initiative — those were considered and not chosen.
  Report and stop; Steven picks.
- Leaving the repo on Pages with a documented reason is a **successful** outcome of this run.
  Leaving it half-migrated is not.

---

## Steps

1. **Baseline + reproduce.** Change no code. Run the full local gate and record the results:
   `npm run d1:migrate:local && npx vitest run && npm run typecheck:server && npm run lint &&
   npm run build`. Then run `npm run pages:dev` and capture the DO bundler error **verbatim**.
   **Verify:** gate all exit 0; the error text `Your Worker depends on the following Durable
   Objects, which are not exported in your entrypoint file: ClarionRealtime` is reproduced and
   pasted into `PROGRESS.md`.
   **Commit:** none (evidence only — append to `PROGRESS.md` and commit that).

2. **Workers entrypoint, alongside the old one.** Create `server/worker.ts`:
   `export default createApp()` plus `export { ClarionRealtime } from './realtime/clarion-realtime'`.
   Hono apps expose `.fetch`, so the app object is a valid Workers default export — the
   `hono/cloudflare-pages` `handle()` wrapper is Pages-specific and is not needed here. Leave
   `functions/api/[[route]].ts` in place for now: this step must change no behaviour.
   **Verify:** `npx vitest run && npm run typecheck:server` → green; `npm run pages:dev` still
   fails with the *same* Step 1 error (proving nothing else moved).
   **Commit:** `feat: Workers entrypoint (server/worker.ts) exporting app + ClarionRealtime`.

3. **Switch wrangler.jsonc to Workers + static assets.** Remove `pages_build_output_dir`; add
   `"main": "server/worker.ts"` and an `assets` block pointing at `./dist`. **Keep untouched:**
   both `d1_databases` bindings (including the `REPLACE_*` placeholders), the `durable_objects`
   binding, the `migrations` block, `compatibility_date`, `nodejs_compat`, and `vars`
   (`AUTH_ENFORCE`, `TWILIO_DRY_RUN`).
   **Known trap:** with static assets, an asset match wins before the Worker runs, and
   `not_found_handling: "single-page-application"` would serve `index.html` for unmatched paths —
   which would swallow `/api/*` and silently break every route. Configure the assets block so
   `/api/*` always reaches the Worker (e.g. `run_worker_first`), and prove it in Step 6.
   **Verify:** `npm run typecheck:server` → green; `npx wrangler dev --dry-run` (or equivalent
   config validation) reports no config error and no missing-DO-export error.
   **Commit:** `feat: wrangler config — Workers + static assets, DO exported natively`.

4. **Update npm scripts.** Replace `pages:dev` with `dev:worker` (`wrangler dev`) and
   `pages:deploy` with `deploy` (`npm run build && wrangler deploy`). Leave `dev`, `build`,
   `test`, `lint`, `typecheck:server`, and both `d1:migrate:*` scripts alone.
   **Note:** adding the `deploy` script does not license you to run it — see invariants.
   **Verify:** `npm run build` → exit 0; `npm run dev:worker` starts and serves; `git grep -n
   "pages:dev\|pages:deploy"` returns only historical hits under `docs/` (CI does not reference
   them — confirmed 2026-07-15).
   **Commit:** `chore: npm scripts — wrangler dev/deploy replace pages:dev/pages:deploy`.

5. **Remove the dead Pages entrypoint.** Delete `functions/api/[[route]].ts` (and the `functions/`
   tree if it is then empty). With `main` set, it is unreachable and keeping it invites a future
   session to edit a file that no longer runs.
   **Verify:** `npx vitest run && npm run typecheck:server && npm run lint && npm run build` →
   all exit 0; `npm run dev:worker` still starts.
   **Commit:** `chore: drop Pages Functions entrypoint (superseded by server/worker.ts)`.

6. **THE PROOF — this is what the run is for.** With `npm run dev:worker` running, verify all
   three, and paste the actual output into `PROGRESS.md`:
   - `curl http://127.0.0.1:8787/api/health` → `{"success":true,"status":"healthy",...}`
     (confirms `/api/*` reaches the Worker and the SPA fallback is not swallowing it).
   - `curl http://127.0.0.1:8787/api/auth-status` → the documented shape, `authenticated:false`.
   - **A real WebSocket handshake to `/api/realtime/socket` completes (HTTP 101).** Use a
     throwaway Node script with a `ws` client, or `curl` with the Upgrade headers. `AUTH_ENFORCE`
     is `"false"` locally, so an unauthenticated socket should reach the DO. **A 101 here is the
     first time the Durable Object has ever run outside a unit test — that is the whole point of
     this run.** If it 500s or the DO can't be reached, that is a Step 6 failure: bail-out rail.
   **Verify:** all three above, with output pasted into `PROGRESS.md`.
   **Commit:** `test: prove ClarionRealtime DO over a live WebSocket under wrangler dev`.

7. **Close the Step 7 leftovers from Phase 2.** Now that the DO actually runs, implement the two
   items deferred in the Phase 2 review (see the archived
   `docs/runs/2026-07-14-phase-2-agents-realtime/PROGRESS.md`, Step 7 entry): **socket identity**
   (a socket should be attributable to a user/agent, not anonymous) and **dead-socket cleanup**
   (hibernation-safe removal of closed sockets so presence doesn't accrete ghosts). Extend
   `test/presence.test.ts` / add tests as needed.
   **Verify:** `npx vitest run && npm run typecheck:server` → green; the Step 6 WebSocket
   handshake still returns 101.
   **Commit:** `feat: DO socket identity + dead-socket cleanup (Phase 2 Step 7 leftovers)`.
   **Stop-safe:** if this step proves larger than it looks, log it under **Blockers** and end the
   run. Steps 1–6 are the value; do not put them at risk for this.

8. **Create the promised cross-repo doc paths.** CLAUDE.md §3/§4 promise `docs/api-contracts/`
   and `docs/change-requests/`, and neither exists — which matters now that three agents run in
   parallel. Create both with a short `README.md` explaining what belongs there and the naming
   convention already specified in §3 (`authpak-<slug>.md`, `workspace-<slug>.md`).
   **Verify:** both directories exist and are committed (a directory with no file won't survive git).
   **Commit:** `docs: scaffold api-contracts + change-requests paths promised by CLAUDE.md`.

9. **Record the stack decision.** Update CLAUDE.md §8 to say Workers + static assets (not Pages
   Functions), and add a dated line to the §2 "Decisions locked" block: what changed, the reason
   (Pages Functions bundler drops DO exports; Workspace has no DO so the mirror-Workspace
   rationale doesn't reach this case), and that Steven approved it 2026-07-15. Mirror it into
   `docs/design/foundry-clarion-design.md` wherever hosting is described. A future session must
   not have to re-derive any of this.
   **Verify:** `git grep -n "Pages Functions"` surfaces no remaining claim that Pages Functions
   is the *current* stack (historical notes in `docs/runs/` and `docs/phase-2-status.md` are fine
   and should be left alone).
   **Commit:** `docs: record Workers+assets stack decision (supersedes Pages Functions)`.

10. **Green capstone.** Write `docs/runs/status-workers-migration.md`: what moved, the DO proof
    output from Step 6, anything left open, and what Phase 3 (queues) can now safely assume.
    **Verify:** full local gate green — `npm run d1:migrate:local && npx vitest run &&
    npm run typecheck:server && npm run lint && npm run build` all exit 0, plus `npm run
    dev:worker` starts clean with the `durable_objects` binding present.
    **Commit:** `docs: Workers migration complete — DO proven over live WebSocket`.
    **Then:** end the run per the protocol in `~/.claude/CLAUDE.md` → "Ending a run" (archive
    this PLAN.md + PROGRESS.md into `docs/runs/<date>-workers-migration/`, write the DONE handoff
    note, commit, and tell Steven to head to his interactive session).

---

## Explicitly NOT in this run

- **Queues** (`0003_queues`, `cc_queues` / `cc_queue_members`, workflow provisioning, org-scoped
  queue routes, inbound TwiML). That is the next run, deliberately, on a foundation you have
  proven. Do not start it, however green things look.
- **Anything live:** no `wrangler deploy`, no Twilio account mutation, no `TWILIO_DRY_RUN="false"`,
  no filling in `database_id` placeholders.
- **The role gate.** Steven confirmed 2026-07-15: keep the per-route `requireClarionRole(...)`
  gates in `server/routes/agents.ts` as they are. A guard test asserting every registered
  `/agents` route carries a gate is wanted, but belongs with the queue run — not here.
- **Merging to `main` or pushing.** `main` was fast-forwarded to Phase 2 locally in this session
  and is 53 commits ahead of `origin/main`, unpushed. Steven owns that push (CLAUDE.md §4).
