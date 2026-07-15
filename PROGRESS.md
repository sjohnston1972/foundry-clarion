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
