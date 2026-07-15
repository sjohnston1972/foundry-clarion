# Foundry Clarion — PROGRESS.md (Run: Phase 3 + UI, on a Workspace-mirrored design system)

**Goal of this run:** close out the blocked Workers-migration run (dev session, real Durable
Object proof, socket cleanup, doc debt), build Phase 3 (queues + inbound calls) entirely under
`TWILIO_DRY_RUN`, and put a real UI on top of it that takes its look and feel directly from
Foundry Workspace — every page backed by an API this run built and driven locally before it is
called done.

Work order: `PLAN.md`. Design and rationale:
`docs/superpowers/specs/2026-07-15-phase-3-and-ui-design.md`.

Append one timestamped entry per verified step below. Never edit history; append only.

---

## 2026-07-15 16:05 — Step 1 done: dev auth behind `DEV_AUTH` (default OFF)

- Added `server/lib/dev-auth.ts` (module-cached in-memory RS256 keypair via jose;
  `isDevAuth` = exact-string `'true'` check; `devVerifyOptions` via `createLocalJWKSet`;
  `mintDevSession` via `SignJWT`; issuer `https://dev.local/authpak`, never AuthPak's).
- Added `server/routes/dev.ts` (`POST /api/dev/session` sets `fnd_session` cookie); guarded
  in `server/app.ts` by a `/dev/*` middleware that 404s unless `isDevAuth(c.env)`. Both
  `verifyFoundrySession` call sites pass `devVerifyOptions()` only when `isDevAuth`.
- Added `DEV_AUTH?: string` to `Bindings` in `server/types.ts`.
- Verified: `npx vitest run test/dev-auth.test.ts` → 3/3 pass (on, unset→401+404,
  'false'→401+404; rejection tests stub `fetch` so no live AuthPak call). Full gate exits 0
  (migrate clean, 38/38 tests, typecheck, lint, build). `git grep DEV_AUTH wrangler.jsonc`
  → no output.
- Commit `8dbd27e` ("feat: dev auth behind DEV_AUTH, default off (Step 1)").
- **Push failed — not a blocker:** remote rejected the branch because an earlier commit on
  it touches `.github/workflows/ci.yml` and the stored OAuth credential lacks the
  `workflow` scope ("refusing to allow an OAuth App to create or update workflow ...
  without `workflow` scope"). All work is committed locally; will retry push on later
  steps. Fix for Steven: re-auth with `gh auth refresh -s workflow` (or push once from a
  credential that has the scope).

## 2026-07-15 16:18 — Step 2 hit its rail: pool-workers cannot run on this machine

Applied the Step 2 rail (do not fight it): the workers project and test were written, the
real `ClarionRealtime` DO **was** exercised in workerd, but the tooling cannot go green on
Windows, so the attempt was reverted. Step 3's live handshake stands as the DO proof for
this run, and Step 4 will use its `test/presence.test.ts` fallback.

### Blockers (tooling, Windows-specific — for a future run or Linux CI)

- `@cloudflare/vitest-pool-workers` **installed compatibly**: `0.12.x` is the last line
  whose peer range (`vitest 2.0.x - 3.2.x`) matches our `vitest@3.2.x`; `0.13.0+` requires
  `vitest ^4.1.0`. Installed `0.12.21` cleanly, no `--force`.
- With default per-test isolated storage: all app-level assertions **passed** on first run
  (real DO: WebSocket 101 + snapshot frame, `/presence` fan-out, persistence via fresh
  stub), but the harness then fails popping the storage stack — Windows cannot unlink the
  DO's still-open SQLite file (`EBUSY ... unlink ...\do\...ClarionRealtime\<id>.sqlite`;
  the pool's `popStackedStorage` has no EBUSY tolerance, `runInDurableObject`-style
  `abortAllDurableObjects` runs but the handle release loses the race). Suite exits 1.
- With `isolatedStorage: false`: every DO storage open fails `SQLITE_CANTOPEN` — nothing
  creates the DO persist dir under miniflare's per-run temp path in non-isolated mode
  (in isolated mode the stack-push `mkdir` creates it as a side effect). Temp path is
  `os.tmpdir()/miniflare-<random16>` per instance, so it cannot be pre-created.
- Reverted: `vitest.config.ts` back to single node project (with a pointer comment),
  `test/workers/` deleted, dependency uninstalled. Gate re-verified green after revert
  (38/38 tests, typecheck, lint, build).
- Recommendation: retry on Linux CI (where unlink-while-open is legal) or after a
  pool-workers release that tolerates EBUSY / creates the DO persist dir; revisit when
  vitest is upgraded to v4 (unlocks pool-workers 0.18+).
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 16:22 — Step 3 done: live 101 under `wrangler dev` (the DO proof)

No application code changed. `DEV_AUTH=true` supplied via gitignored `.dev.vars` (wrangler
does not inject arbitrary process env into worker bindings; `.dev.vars` is the sanctioned
local-only channel, never committed). `wrangler dev` on `http://127.0.0.1:8787`; client was
a throwaway Node script (`node:http` for the raw upgrade so status/headers/frame are shown
explicitly; deleted after the run, not committed). Server started and stopped cleanly.

Verbatim client output:

```
GET /api/health -> 200 {"success":true,"status":"healthy","database":"connected","timestamp":"2026-07-15T15:21:03.160Z"}
POST /api/dev/session -> 200 (cookie: fnd_session=eyJhbGciOiJSUzI1Ni...)
GET /api/auth-status -> 200 {"success":true,"data":{"authenticated":true,"hasOrg":true,"email":"dev@example.com","orgId":"org-dev","orgSlug":"dev","orgRole":"owner","clarionRole":"admin","disabled":false}}
WS handshake -> 101
Sec-WebSocket-Accept: khW6RE2eNOgjlEbnrVHsYddFWbI=
first frame (opcode 1): {"type":"presence","agents":[]}
```

This is the proof the previous run could not get: a real browser-path WebSocket handshake
through the auth gate (`requireClarionRole('agent')`, dev-owner bootstraps to `admin`) into
the org's live `ClarionRealtime` Durable Object, answering **101** with a
`Sec-WebSocket-Accept` and immediately pushing the presence snapshot frame. Per the Step 2
rail, this live handshake stands as the run's DO proof.

Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 16:29 — Step 4 done: DO socket identity + disconnect cleanup

- `server/routes/realtime.ts`: the socket route now pins the **session** email onto the
  forwarded DO URL (`?identity=`) — the DO never trusts a client-supplied identity; 400 if
  the session somehow has no email.
- `server/realtime/clarion-realtime.ts`: on upgrade the DO attaches the route-supplied
  identity with `serializeAttachment` (survives hibernation); `webSocketClose` recovers it
  via `deserializeAttachment`, applies an `offline` presence event, persists, broadcasts.
- Tests (Step 2-rail fallback, reduced coverage acknowledged): the disconnect-cleanup
  semantics are asserted at the `applyPresence` level in `test/presence.test.ts`
  (two identities, one goes offline, survivor untouched, snapshot correct), and
  `test/realtime-route.test.ts` now asserts the route pins `identity=agent@acme.com` on
  the forwarded URL. The DO's own attach/close path is not executed by vitest on this
  machine (no workers project — see Step 2 Blockers).
- **Compensating live verification** (real DO under `wrangler dev`, throwaway Node client,
  deleted after; server stopped cleanly). Verbatim tail:

```
A(ada): handshake -> 101
B(bob): handshake -> 101
B frame: {"type":"presence","agents":[{"identity":"ada@x.com","status":"available","at":10},{"identity":"bob@x.com","status":"on-call","at":20}]}
--- closing A (client close frame) ---
B frame: {"type":"presence","agents":[{"identity":"bob@x.com","status":"on-call","at":20}]}
PASS: closed identity removed from roster; survivor untouched
```

- Note: with the current reducer, `offline` **removes** the identity from the roster (the
  snapshot omits it) rather than listing it with an `offline` status — that is the existing
  `applyPresence` contract from Phase 2, unchanged by this step.
- Gate exits 0 (39/39 tests, typecheck, lint, build).
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 17:52 — Step 5 done: documentation debt in CLAUDE.md

- §8: replaced the stale "Hono as Pages Functions — `functions/api/[[route]].ts`" line with
  the actual setup — Hono served from Cloudflare Workers with static assets, entrypoint
  `server/worker.ts` (also exports the `ClarionRealtime` DO class per `wrangler.jsonc` `main`).
- §12: added "The `DEV_AUTH` exception" with all five boundaries copied **verbatim** from
  spec §3.1 (defaults off; local `wrangler dev`/tests only; never in
  `wrangler.jsonc`/CI/deploy; a test asserts rejection when unset; dev keypair is not an
  AuthPak key; the on-anywhere-else-stop rail), plus a pointer to the implementation files
  and the spec.
- §14 (new): "Design system" — records the vendored-snapshot mechanism (Workspace's
  `@theme` block + `ui.tsx` copied verbatim with provenance headers), that `AppShell.tsx`
  deliberately does **not** port, that `test/design-drift.test.ts` is the guard, and that a
  shared `@foundry/ui` package is out of scope while Clarion is read-only on
  `skills-foundry`. Written ahead of Step 9, which builds the file this section describes —
  consistent with the plan's explicit instruction for this step.
- §11: checked off the `DEV_AUTH` and UI-look-and-feel open questions (both resolved
  2026-07-15), added a new open item for the future `@foundry/ui` extraction.
- Verified: `git grep -n "functions/api" CLAUDE.md` → no output;
  `git grep -n "DEV_AUTH" CLAUDE.md` → 6 hits (§11, §12 x5). Gate exits 0 (39/39 tests,
  typecheck, lint, build).
- Commit `2956915`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 17:55 — Step 6 done: schema + typed accessors for queues, membership, calls

- `migrations/0003_queues_calls.sql`: `cc_queues` (id, organization_id, name,
  twilio_workflow_sid, strategy, created_at; unique on org+name), `cc_queue_members`
  (queue_id, agent_id, priority; composite PK, FKs to `cc_queues`/`cc_agents` with
  `ON DELETE CASCADE`), `cc_calls` (id, organization_id, twilio_call_sid, from_e164,
  to_e164, queue_id, agent_id, disposition, duration_s, started_at; unique on
  org+twilio_call_sid, FKs `ON DELETE SET NULL`). All three indexed by `organization_id`
  per design §4.
- `server/db/queues.ts`: `insertQueue`, `getQueueById`, `listQueues`, `deleteQueue`,
  `addQueueMember`/`removeQueueMember`/`listQueueMembers` — mirrors `server/db/agents.ts`'s
  shape (typed row mapper, org-scoped WHERE clauses throughout).
- `server/db/calls.ts`: `insertCall`, `getCallBySid`, `listCallsForOrg`,
  `updateCallOutcome` (disposition/duration/agent) — same shape.
- Tests: `test/queues-migration.test.ts` (mirrors `test/agents-migration.test.ts`, asserts
  the three tables and their org-scoping/FK constraints exist in the SQL); `test/queues-
  db.test.ts` and `test/calls-db.test.ts` (insert/read/list/delete/update against an
  in-memory fake D1, **each including a cross-tenant leak test** — org B cannot read org
  A's queues or calls via `getQueueById`/`getCallBySid`/`listQueues`/`listCallsForOrg`).
- Verified: `npm run d1:migrate:local` applied `0003_queues_calls.sql` cleanly (10 SQL
  commands, ✅). Gate exits 0 (48/48 tests, typecheck, lint, build).
- Commit `e3e53e1`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 17:58 — Step 7 done: queues API + Workflow provisioning (dry-run)

- `server/lib/twilio/provisioning.ts`: added `createWorkflow`, following the existing
  `createWorker`/`isDryRun` pattern exactly — dry-run returns a deterministic
  `WWdryrun_<uuid>` and makes no network call; the live path (POST to
  `.../Workspaces/{sid}/Workflows`) is written but unreachable while
  `TWILIO_DRY_RUN !== 'false'`.
- `server/db/queues.ts`: added `updateQueue` (name/strategy patch) so the route layer has
  no raw SQL, per CLAUDE.md §10.
- `server/routes/queues.ts` (new), mounted at `/api/queues` in `server/app.ts`:
  `GET /` and `GET /:id/members` (supervisor+); `POST /`, `PATCH /:id`, `DELETE /:id`,
  `POST /:id/members`, `DELETE /:id/members/:agentId` (admin). Input validation → auth
  check → business logic → response throughout.
- `test/queues-route.test.ts` (6 tests): agent gets 403 on both create and list; supervisor
  gets 403 on create but 200 on list; admin creates a queue and gets a `WWdryrun_`-prefixed
  `twilioWorkflowSid`; a `fetch` spy asserts **no call to `taskrouter.twilio.com`** occurs
  during dry-run creation; empty `name` is rejected with 400.
- Verified: `npx vitest run test/queues-route.test.ts` → 6/6 pass. Gate exits 0 (54/54
  tests, typecheck, lint, build). `git grep -n "TWILIO_DRY_RUN" wrangler.jsonc` still shows
  `"true"`.
- Commit `8299fd8`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.
