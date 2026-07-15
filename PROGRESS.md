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
