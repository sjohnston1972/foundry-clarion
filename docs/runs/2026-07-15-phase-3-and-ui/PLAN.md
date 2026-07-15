# Foundry Clarion — PLAN.md (Run: Phase 3 + UI, on a Workspace-mirrored design system)

Autonomous-run work order. One small, commit-able step per turn, each ending in a check you
can actually run. Commit **and push** after each step, then append a timestamped line to
`PROGRESS.md`.

**Goal of this run, in one sentence:** close out the blocked Workers-migration run, build
Phase 3 (queues + inbound) entirely under `TWILIO_DRY_RUN`, and put a real UI on top of it
that takes its look and feel directly from Foundry Workspace.

**Why this run exists:** Phases 0–2 built an auth spine, agents, and a realtime Durable
Object, but the UI is a 247-line placeholder and the DO has never been exercised for real.
The previous run stopped at its Step 6 believing no local session was obtainable. **That
belief was factually wrong** — see "The correction" below. Full design and rationale:
`docs/superpowers/specs/2026-07-15-phase-3-and-ui-design.md`. Read it before Step 1.

**Decision authority:** Steven approved this run's scope, the `DEV_AUTH` exception, the
vendored-design-system mechanism, and the branch rename in-session on 2026-07-15.
**Do not re-open those decisions; do not extend them.**

---

## The correction (read once, then act on it)

The previous run's `PROGRESS.md` states there is "no local override in the vendored
`@foundry/auth` package." **This is wrong.** `node_modules/@foundry/auth/dist/types.d.ts`
exports:

```ts
export interface VerifyOptions {
    jwksUrl?: string;
    issuer?: string;
    audience?: string;
    cookieName?: string;
    /** Advanced/testing escape hatch: supply a key resolver instead of the cached remote JWKS. */
    jwks?: JWTVerifyGetKey;
}
```

and `verifyFoundrySession(req, opts?: VerifyOptions)` accepts it. `server/app.ts` lines ~24
and ~43 simply never pass it. Step 1 uses this sanctioned escape hatch. You are not
inventing an API; verify the signature yourself before you rely on it.

---

## Invariants (apply to EVERY step)

- Package manager **npm**. **No `any`.** `organization_id` / `user_id` are TEXT.
- Success envelope `{ success, data }`; errors `{ error: { code, message } }`.
- Branch **`feat/clarion-phase-3-and-ui`** only. **Never commit to `main`.** Do not create
  branches. Push after every step; if push fails, note it in `PROGRESS.md` and carry on.
- **Never write to `WORKSPACE_DB`** (read-only bind). Every query filters by `organization_id`.
- **Never commit in `authpak/` or `skills-foundry/`.** Read-only, always (CLAUDE.md §4).
- Secrets never reach the frontend bundle.
- `TWILIO_DRY_RUN` stays `"true"`. **Do not flip it. No Twilio account mutation of any kind.**
- **No Cloudflare account change.** `wrangler dev` allowed; `wrangler deploy` is not.
- Do not fill in the `REPLACE_*` `database_id` placeholders. That is a deploy task.
- Every route handler: input validation → auth check → business logic → response, in that order.
- Every table gets a typed accessor in `server/db/<table>.ts`. No raw SQL in handlers.
- Files over ~300 lines get split.

## The full local gate

Referred to below as **"the gate"**:

```bash
npm run d1:migrate:local && npx vitest run && npm run typecheck:server && npm run lint && npm run build
```

All must exit 0. Run it before marking any step done.

## Rails — read before you start

- **Step 9 is the linchpin.** If it cannot go green after one honest attempt, **stop** and
  end the run. Do not build pages on a design system you could not verify.
- **Step 2 is non-fatal.** If `@cloudflare/vitest-pool-workers` cannot be installed
  compatibly with `vitest@3.2.4` after one honest attempt, do **not** fight it and do **not**
  downgrade vitest. Note it under Blockers in `PROGRESS.md`, skip to Step 3, and let Step 3's
  live handshake stand as the DO proof for this run.
- **Playwright fallback.** If the browser download fails, note it in `PROGRESS.md`, fall back
  to `@testing-library/react` + `jsdom` for component assertions plus a `fetch` check on the
  served HTML, and carry on. **Never claim UI verification that did not happen.**
- **Hard stops.** If any Twilio call would go live, **stop**. If `DEV_AUTH` would need to be
  on anywhere but local `wrangler dev`, **stop**. If a step needs a decision from Steven,
  **stop**: write the question under Blockers in `PROGRESS.md` and end the run.
- Arcs are ordered so a dead run dies at a coherent boundary. Do not reorder them.

---

## Steps

### Arc A — close out the migration run

1. **Dev auth behind `DEV_AUTH` (default OFF).**
   Create `server/lib/dev-auth.ts`: a module-cached RS256 keypair from `jose`'s
   `generateKeyPair` (never persisted to disk, never committed), exporting
   `isDevAuth(env: Bindings): boolean` (`env.DEV_AUTH === 'true'` — exact string, nothing
   looser), `devVerifyOptions(): Promise<VerifyOptions>` built with `createLocalJWKSet`, and
   `mintDevSession(claims: { sub, email, org_id, org_slug, role }): Promise<string>` via
   `SignJWT`. Use issuer `https://dev.local/authpak` — **not** AuthPak's issuer — so a dev
   token is never mistakable for a real one, and pass `issuer` in the verify options to match.
   Add `DEV_AUTH?: string` to `Bindings` in `server/types.ts`.
   Create `server/routes/dev.ts` with `POST /api/dev/session` (body `{ email, orgId, role }`)
   setting the `fnd_session` cookie. In `server/app.ts`, mount it **only** when
   `isDevAuth(c.env)`, and pass `await devVerifyOptions()` to **both** `verifyFoundrySession`
   call sites (~line 24 and ~line 43) when and only when `isDevAuth(c.env)` is true.
   Tests in `test/dev-auth.test.ts` — all three are required:
   (a) with `DEV_AUTH: 'true'`, a minted token resolves a session and `/api/me` returns 200;
   (b) with `DEV_AUTH` **unset**, that same minted token is **rejected** and `/api/dev/session`
   returns **404**;
   (c) with `DEV_AUTH: 'false'`, same as (b).
   **Verify:** `npx vitest run test/dev-auth.test.ts` → 3 pass; the gate exits 0;
   `git grep -n "DEV_AUTH" wrangler.jsonc` → **no output** (it is never a deployed var).

2. **Real DO proof in workerd.** `npm i -D @cloudflare/vitest-pool-workers`. Convert
   `vitest.config.ts` to a projects config: keep the existing `node` project as-is
   (`test/**/*.test.ts`, minus the new dir) and add a `workers` project via
   `defineWorkersConfig` pointed at `wrangler.jsonc`, including `test/workers/**/*.test.ts`.
   Write `test/workers/realtime-do.test.ts` exercising the **real** `ClarionRealtime` class
   (not a fake stub — `test/realtime-route.test.ts` already fakes it, which is the gap):
   (a) a WebSocket upgrade to the DO returns **101** and the socket immediately receives the
   presence snapshot frame `snapshotMessage` sends on connect;
   (b) a `POST /presence` fans the updated snapshot out to a connected socket;
   (c) presence survives — write state, then read it back through a fresh stub for the same
   `idFromName`, and assert the roster is intact.
   **Verify:** `npx vitest run` → both projects pass, the new file included; the gate exits 0.
   **If pool-workers won't install compatibly: apply the Step 2 rail above and move on.**

3. **Live 101 under `wrangler dev`** — the proof the last run could not get.
   Change no application code. Start `DEV_AUTH=true npm run dev:worker` in the background.
   Mint a session against `POST /api/dev/session`, then open a real WebSocket handshake to
   `/api/realtime/socket` carrying the returned `fnd_session` cookie. Use Node's `http`/`fetch`
   as the client (`curl` needed interactive approval last run and was unavailable).
   **Verify:** paste **verbatim** into `PROGRESS.md`: `GET /api/health` → 200;
   `GET /api/auth-status` → 200 with `authenticated:true`; the handshake → **101** with a
   `Sec-WebSocket-Accept` header and the first presence frame received. Stop the background
   task cleanly before writing the entry.

4. **DO socket identity + disconnect cleanup.**
   `server/realtime/clarion-realtime.ts:66`'s `webSocketClose` only closes the socket — the DO
   never associates a socket with an identity, so a disconnecting agent stays in the roster at
   its last status forever. Fix: on upgrade, read the identity from the query string that
   `server/routes/realtime.ts` appends (the route knows the caller; the DO must not trust a
   client-supplied identity), and attach it with `ws.serializeAttachment({ identity })` so it
   survives hibernation. In `webSocketClose`, recover it with `ws.deserializeAttachment()`,
   apply an `offline` presence event for that identity, persist, and broadcast.
   Add to `test/workers/realtime-do.test.ts`: connect two sockets with distinct identities,
   close one, assert the survivor receives a snapshot showing the closed identity `offline`
   and the other untouched.
   **Verify:** `npx vitest run` → new assertions pass; the gate exits 0.
   **If Step 2 hit its rail** (no workers project): put the identity/cleanup test in
   `test/presence.test.ts` at the `applyPresence` level instead, note the reduced coverage in
   `PROGRESS.md`, and continue.

5. **Documentation debt.** In `CLAUDE.md`: fix §8, which still says
   "**Backend:** Hono as Pages Functions — `functions/api/[[route]].ts`" — that file was
   deleted in the last run; it is now `server/worker.ts` on Workers-with-static-assets. Add
   the `DEV_AUTH` exception to §12 with **all five boundaries verbatim from spec §3.1**
   (defaults off; local `wrangler dev` and tests only; never in `wrangler.jsonc`/CI/deploy; a
   test asserts rejection when unset; the key is not an AuthPak key). Add a §14 "Design
   system" recording that Clarion vendors Workspace's tokens and `ui.tsx`, that
   `AppShell.tsx` deliberately does **not** port, and that the drift test is the guard.
   Update §11's open-questions list.
   **Verify:** `git grep -n "functions/api" CLAUDE.md` → **no output**;
   `git grep -n "DEV_AUTH" CLAUDE.md` → hits in §12; the gate exits 0.

### Arc B — Phase 3, dry-run only

6. **Schema: queues, membership, calls.** Create `migrations/0003_queues_calls.sql` for
   `cc_queues` (id, organization_id, name, twilio_workflow_sid, strategy, created_at),
   `cc_queue_members` (queue_id, agent_id, priority), `cc_calls` (id, organization_id,
   twilio_call_sid, from_e164, to_e164, queue_id, agent_id, disposition, duration_s,
   started_at) — every table `organization_id` TEXT, indexed, matching design §4. Typed
   accessors `server/db/queues.ts` and `server/db/calls.ts`, mirroring the existing shape of
   `server/db/agents.ts`. Tests `test/queues-db.test.ts`, `test/calls-db.test.ts`, and
   `test/queues-migration.test.ts` (mirror `test/agents-migration.test.ts`), **including a
   cross-tenant leak test** asserting org A cannot read org B's queues.
   **Verify:** `npm run d1:migrate:local` applies 0003 cleanly; `npx vitest run` passes; gate 0.

7. **Queues API + Workflow provisioning (dry-run).** Add `createWorkflow` to
   `server/lib/twilio/provisioning.ts` following the **existing** `isDryRun` pattern at
   line 5 exactly: dry-run returns a deterministic `WWdryrun_<uuid>` and makes **no network
   call**; the live path is written but unreachable while `TWILIO_DRY_RUN !== 'false'`.
   Create `server/routes/queues.ts`: list (`supervisor`), create/update/delete and membership
   (`admin`), all `requireClarionRole`-gated, mounted in `server/app.ts`. Tests
   `test/queues-route.test.ts` covering each role gate (agent gets 403 on create), the
   dry-run SID shape, and **an assertion that no `fetch` to `taskrouter.twilio.com` occurs**.
   **Verify:** `npx vitest run test/queues-route.test.ts` passes; gate 0;
   `git grep -n "TWILIO_DRY_RUN" wrangler.jsonc` still shows `"true"`.

8. **Inbound TwiML + status webhooks → DO → `cc_calls`.** Create `server/routes/voice.ts`:
   `POST /api/voice/inbound` returning `<Response>` TwiML that enqueues to the org's Workflow,
   and `POST /api/voice/status` recording call state into `cc_calls` and pushing an event to
   the org DO via the existing `pushPresence` sibling in `server/routes/realtime.ts`.
   **These are Twilio-called, not browser-called: they are outside the AuthPak gate and must
   validate the `X-Twilio-Signature` header** using `TWILIO_AUTH_TOKEN` — implement it in
   `server/lib/twilio/signature.ts` and reject with 403 on mismatch. Tests
   `test/voice-route.test.ts`: valid signature accepted, invalid/missing rejected 403, TwiML
   shape asserted, `cc_calls` row written, DO event pushed.
   **Verify:** `npx vitest run test/voice-route.test.ts` passes; gate 0.

### Arc C — UI

9. **LINCHPIN — port the design system.** Read spec §4 in full first.
   `npm i clsx tailwind-merge lucide-react`. Create `src/lib/utils.ts` with `cn` (copy
   `skills-foundry/src/lib/utils.ts` — it is 6 lines). Replace `src/index.css`'s `@theme`
   block with Workspace's **complete** block from `skills-foundry/src/index.css` — Clarion is
   currently missing `--color-raised`, `--color-faint`, `--color-ink-2`, `--color-line-2`,
   `--color-accent-soft`, `--radius-card`, `--shadow-card`, `--shadow-pop`, `.tabular`, and
   the scrollbar rules. `ui.tsx` reads `--radius-card` and `--shadow-card` directly, so a
   partial port renders silently wrong. Keep Workspace's `--accent` indirection; Clarion
   fixes the accent at `#00a3ff` (it has no departments).
   Copy `skills-foundry/src/components/ui.tsx` **verbatim** to `src/components/ui.tsx`.
   Both files get a provenance header naming source repo, path, and commit — baselines:
   `skills-foundry` HEAD `29ed077`, `src/index.css` last touched `35e268c`,
   `src/components/ui.tsx` last touched `673b50c`.
   Create `test/design-drift.test.ts`: resolve the sibling at `../skills-foundry`, **skip
   cleanly when absent** (`it.skip`, so CI is unaffected), and otherwise assert the vendored
   copies still match the sibling's current content — failing loudly when Workspace's design
   system has moved.
   `npm i -D @playwright/test && npx playwright install chromium`.
   **Verify:** `npx vitest run test/design-drift.test.ts` passes (not skipped — the sibling is
   on disk); gate 0; a Playwright run renders a page using vendored `Card` + `Button` +
   `Badge` and saves a screenshot to `docs/runs/2026-07-15-phase-3-and-ui/step-9-tokens.png`.
   **If this cannot go green after one honest attempt, STOP and end the run.**

10. **App shell + auth gate.** Create `src/components/AppShell.tsx` — Clarion's own, built on
    the vendored primitives, mirroring Workspace's **structure** (sidebar nav, header,
    `Outlet`, `NavLink`, lucide icons). Do **not** copy `skills-foundry`'s `AppShell.tsx`: it
    is 641 lines wired into departments, plans, billing, tickets, and a command palette that
    Clarion does not have. Nav: Softphone, Agents, Queues, Wallboard. Add `react-router-dom`
    routing in `src/App.tsx`, and move the existing gate card into
    `src/components/AuthGate.tsx`, preserving all three existing states (signed-out,
    no-access, in) from `src/App.tsx:1`.
    **Verify:** gate 0; Playwright, with `DEV_AUTH=true` and a minted session, loads `/`,
    asserts the nav renders all four items, and screenshots to
    `docs/runs/2026-07-15-phase-3-and-ui/step-10-shell.png`. Signed-out (no cookie) still
    renders the sign-in card.

11. **Agents page.** `src/pages/Agents.tsx` against the existing `/api/agents`, `/api/agents/
    candidates`, `/api/agents/enable`: list current agents, list Workspace candidates,
    enable one. Use `@tanstack/react-query` (already a dependency) and vendored `Card`,
    `Button`, `Badge`, `EmptyState`, `TableSkeleton`, `ErrorState` — no bespoke styling.
    **Verify:** gate 0; Playwright signs in via `DEV_AUTH`, loads `/agents`, enables a
    candidate, asserts it appears in the agent list, screenshots to
    `docs/runs/2026-07-15-phase-3-and-ui/step-11-agents.png`.

12. **Queues page.** `src/pages/Queues.tsx` against Step 7's API: list, create, assign agents.
    Same vendored primitives. Dry-run `WWdryrun_*` SIDs will be visible — that is expected and
    correct; surface them in a `.tabular` readout rather than hiding them.
    **Verify:** gate 0; Playwright creates a queue, asserts it lists with its dry-run SID,
    screenshots to `docs/runs/2026-07-15-phase-3-and-ui/step-12-queues.png`.

13. **Softphone page.** `src/pages/Softphone.tsx`, replacing the placeholder `SoftphonePanel`
    in `src/App.tsx`. Keep the existing behaviour from `src/lib/twilio-voice.ts` (register via
    `/api/token/voice`, status change, presence socket) but rebuild the surface on vendored
    primitives with real states: registering, registered, unavailable (the `token 503` path
    already handled today), error.
    **Verify:** gate 0; Playwright loads `/softphone`, asserts the presence list renders from a
    live DO socket, changes status and asserts the roster updates, screenshots to
    `docs/runs/2026-07-15-phase-3-and-ui/step-13-softphone.png`.

14. **Wallboard scaffold.** `src/pages/Wallboard.tsx`: subscribe to the org DO stream and
    render live presence using vendored `Stat` + `Card`. **Scaffold only** — Steven approved
    exactly this. No monitor/whisper/barge (Phase 5), no call metrics (no live call events
    exist yet). Where call volume will go, render an `EmptyState` saying so.
    **Verify:** gate 0; Playwright loads `/wallboard`, asserts a presence tile appears for an
    agent whose status was changed via the API, screenshots to
    `docs/runs/2026-07-15-phase-3-and-ui/step-14-wallboard.png`.

15. **Capstone + close the run.** Run the gate one final time and paste the output into
    `PROGRESS.md`. Confirm no live Twilio call was ever made
    (`git grep -n "TWILIO_DRY_RUN" wrangler.jsonc` → `"true"`) and `DEV_AUTH` appears in no
    deployed config (`git grep -n "DEV_AUTH" wrangler.jsonc` → no output). Then end the run
    per CLAUDE.md: archive `PLAN.md` + `PROGRESS.md` to
    `docs/runs/2026-07-15-phase-3-and-ui/`, write `DONE` as a real handoff note (what landed,
    what is blocked, where the archive went, recommended next run), commit and push both
    together.
    **Verify:** gate 0; `docs/runs/2026-07-15-phase-3-and-ui/` contains `PLAN.md`,
    `PROGRESS.md`, and the step screenshots; `DONE` exists and is non-empty; working tree clean.

---

## Explicitly NOT in this run

- **Any live Twilio account mutation.** No buying numbers, no creating a real TaskRouter
  Workspace or Workflow. `TWILIO_DRY_RUN` stays `"true"`. Steven must be in-session for that.
- **Deploying anything.** No `wrangler deploy`. No Cloudflare account change.
- Recording capture, R2, transcripts, reporting (Phase 4).
- Supervisor monitor/whisper/barge, outbound click-to-call (Phase 5).
- Extracting a shared `@foundry/ui` package — needs a Workspace-side change and Clarion is
  read-only on `skills-foundry` (CLAUDE.md §4).
- Editing `skills-foundry` or `authpak` in any way, including "just a small fix".
- Pushing `main`, or merging this branch. Steven owns both.
- Widening `DEV_AUTH` beyond local `wrangler dev` and tests, for any reason.
