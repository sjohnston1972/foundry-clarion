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

## 2026-07-15 18:03 — Step 8 done: inbound TwiML + status webhooks (signature-validated)

- `server/lib/twilio/signature.ts`: implements Twilio's request-signing algorithm
  (HMAC-SHA1 over `url + sorted "key"+"value" pairs`, base64, via Web Crypto —
  `crypto.subtle`, Workers-native), `computeTwilioSignature` (exported for tests) and
  `isValidTwilioSignature` (fails closed: no auth token or no header ⇒ invalid; constant-time
  string compare).
- `server/routes/voice.ts`: `POST /api/voice/inbound` and `POST /api/voice/status`. Both
  parse the Twilio form body once, validate `X-Twilio-Signature` first (before touching the
  DB), and reject 403 on mismatch. Inbound returns `<Response><Enqueue
  workflowSid="...">...</Enqueue></Response>` TwiML; status writes/updates a `cc_calls` row
  (disposition, duration, agent) and pushes an event to the org DO via the existing
  `pushPresence` sibling in `server/routes/realtime.ts`.
- **Design call**: no `cc_numbers` table exists in this run's scope (not in the Arc B plan —
  only queues/membership/calls), so there is no dialed-number → org/queue lookup available.
  Both webhooks resolve the org and queue via `?orgId=&queueId=` on the webhook URL, which
  is configured per-number in the Twilio console (a real, supported pattern) rather than
  invented API surface. Flagged here for visibility, not filed as a change request since it
  doesn't touch a sibling repo — `cc_numbers` + number-to-webhook-URL provisioning is future
  work (Phase 4/webhook-URL work), not a blocker for this dry-run-only step.
- `server/app.ts`: `/voice` mounted **before** the `app.use('/*', verifyFoundrySession...)`
  gate, alongside `/health` and `/dev` — these are Twilio-called, not browser-called, and
  authenticate via the signature header instead of the `fnd_session` cookie.
- Tests (`test/voice-route.test.ts`, 5): missing signature → 403; invalid signature → 403;
  valid signature → 200 with TwiML containing `<Enqueue workflowSid="WWabc123">`; status
  webhook with a valid signature writes a `cc_calls` row and pushes a `/presence` event to
  the fake org DO stub; status webhook with a missing signature → 403.
- Verified: `npx vitest run test/voice-route.test.ts` → 5/5 pass. Gate exits 0 (59/59 tests,
  typecheck, lint, build).
- Commit `f1d3913`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 18:13 — Step 9 done: LINCHPIN — design system ported, gate green

Read spec §4 in full first, per the step's instruction. Confirmed the sibling before
touching anything: `git -C ../skills-foundry rev-parse HEAD` → `29ed077...`, and
`git log -1 -- src/index.css` / `src/components/ui.tsx` → `35e268c` / `673b50c` — all three
match the plan's stated baselines exactly, so no drift had occurred since the design was
authored.

- `npm i clsx tailwind-merge lucide-react`; `npm i -D @playwright/test && npx playwright
  install chromium` — installed cleanly, chromium launches (verified with a standalone
  `chromium.launch()` smoke check before writing any tests).
- `src/lib/utils.ts`: `cn` copied verbatim (6 lines) with a one-line provenance comment.
- `src/index.css`: replaced the `@theme` block with Workspace's complete one (verbatim,
  including its "set at runtime per active department" comment — left unchanged so the
  block stays byte-for-byte identical to the source, which is what the drift test checks);
  added the `:root` accent vars (`--accent`/`--accent-soft` fixed at `#00a3ff`/`#e6f5ff`,
  not runtime department-switched — Clarion has one app), `.tabular`, and the three
  `::-webkit-scrollbar*` rules, all verbatim. Deliberately did **not** vendor Workspace's
  `.md` (chat markdown) or `.react-flow__node` (org chart) rules — Clarion has neither
  feature, and the spec's missing-tokens list didn't call for them.
- `src/components/ui.tsx`: copied verbatim (`Card`, `CardHead`, `Button`, `Badge`, `Stat`,
  `Spinner`, `EmptyState`, `Loader`, `Skeleton`, `TableSkeleton`, `ErrorState`) behind a
  provenance header + a `// --- vendored verbatim below ---` sentinel the drift test splits
  on, so the header itself never has to byte-match the sibling.
- `test/design-drift.test.ts` (5 tests, `it.skip` when the sibling is absent): extracts and
  compares the `@theme` block, the `:root` block, `.tabular` + the scrollbar rules, the full
  `ui.tsx` body (post-sentinel), and `utils.ts` (post-provenance-comment) against the live
  sibling content — normalizing CRLF/LF first (the sibling checkout is CRLF; that's a
  checkout artifact, not design drift). All 5 ran for real (not skipped) and passed.
- **Playwright proof** (`playwright.config.ts` + `test/e2e/`): a dev-only fixture
  (`design-tokens.html` + `-main.tsx`, never referenced by `src/main.tsx`/`index.html`, not
  in `vite build` output) mounts vendored `Card`+`CardHead`+`Button`(both variants)+`Badge`.
  The spec asserts visibility of each, then reads the Primary button's **computed**
  `background-color` and asserts it's exactly `rgb(0, 163, 255)` (`#00a3ff`) — proof the
  actual `--color-accent` token value flows through the Tailwind v4 pipeline, not just that
  a class name applied. Screenshot saved to
  `docs/runs/2026-07-15-phase-3-and-ui/step-9-tokens.png` (viewed — rounded card with the
  vendored shadow/radius, Space Grotesk heading, correct accent blue, light-blue accent
  badge, gray neutral badge — matches Workspace's look exactly).
- **One hiccup, not a blocker**: Playwright's `webServer` health check against
  `http://127.0.0.1:5173` timed out — `127.0.0.1` doesn't resolve to the Vite dev server in
  this environment/sandbox, only the `localhost` hostname does (confirmed directly: a
  `fetch('http://127.0.0.1:5173/')` failed, `fetch('http://localhost:5173/')` returned 200).
  Switched `playwright.config.ts`'s `baseURL`/`webServer.url` to `localhost`; no other
  change needed. Also fixed `ReferenceError: __dirname is not defined` in the ESM spec file
  by using `import.meta.dirname` instead.
- Added `/test-results/` and `/playwright-report/` to `.gitignore` (Playwright run
  artifacts; the screenshot we intentionally keep lives under `docs/runs/`, not there).
- Verified: `npx vitest run test/design-drift.test.ts` → 5/5 pass, not skipped.
  `npx playwright test` → 1/1 pass. Full gate exits 0 (64/64 vitest tests, typecheck, lint,
  build).
- Commit `a6fc2a8`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 18:20 — Step 10 done: app shell + auth gate, routing wired

- `src/components/AppShell.tsx` (new): Clarion's own — sidebar nav (Softphone, Agents,
  Queues, Wallboard with lucide icons), header showing `email · clarionRole`, `<Outlet
  context={status}/>` — built on the vendored primitives and `cn`, mirroring Workspace's
  *structure* only. Did **not** port `skills-foundry`'s 641-line `AppShell.tsx` (departments/
  plans/billing/tickets/command palette Clarion doesn't have), per the plan's explicit rail.
- `src/components/AuthGate.tsx` (new): the gate card extracted from `src/App.tsx`, now built
  on vendored `Card` instead of a hand-rolled div. Preserves all three `Gate` states
  (signed-out, no-access, app) plus the pre-classification loading/error states; on success
  renders `<Outlet context={status}/>` instead of the shell itself, handing `status` down to
  `AppShell` via `useOutletContext`.
- `src/App.tsx`: added `react-router-dom` routes — `<AuthGate>` wraps `<AppShell>` wraps an
  index route (`SoftphonePanel`, left **unchanged in place** — Step 13 replaces it with
  `src/pages/Softphone.tsx`) plus `/agents`, `/queues`, `/wallboard` stub routes rendering
  vendored `EmptyState` until Steps 11/12/14 build the real pages. Removed the old inline
  `Shell`/`SignedOut`/`NoAccess`/`AppShell` functions (moved to `AuthGate.tsx`/
  `AppShell.tsx`) — the old local `AppShell` name would otherwise have collided with the
  new import.
- `src/main.tsx`: wraps `<App/>` in `<BrowserRouter>`.
- **Bug found and fixed in passing**: `vite.config.ts`'s dev proxy still pointed at
  `127.0.0.1:8788` — the deleted Pages Functions dev port. The Worker migration moved
  `wrangler dev` to `:8787`; this was silently broken (no Playwright spec had driven the
  live app + API together before Step 10) and is now fixed to `localhost:8787` (`localhost`,
  not `127.0.0.1` — same resolution issue as Step 9's Playwright note).
- **Playwright** (`test/e2e/app-shell.spec.ts`, 2 tests): `playwright.config.ts`'s
  `webServer` now starts **both** `wrangler dev` (DEV_AUTH via `.dev.vars`, added in Step 3,
  never committed) and `vite dev`, since this spec needs the live API. Test 1 POSTs
  `/api/dev/session` via `context.request` (shares cookie storage with `page`), loads `/`,
  asserts all four nav links (`Softphone`/`Agents`/`Queues`/`Wallboard`) are visible,
  screenshots to `docs/runs/2026-07-15-phase-3-and-ui/step-10-shell.png` (viewed — sidebar
  with active-state highlight on Softphone, header identity, softphone panel in the main
  area). Test 2: no cookie → the sign-in card still renders.
- Verified: `npx playwright test` → 3/3 pass (both new tests + Step 9's still-passing
  fixture test). Full gate exits 0 (64/64 vitest tests, typecheck, lint, build — `vite
  build` now transforms 1830 modules vs. 59 before, reflecting `react-router-dom` +
  `lucide-react` entering the bundle graph via the new shell).
- Commit `1d690f0`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 18:38 — Step 11 done: Agents page (list, candidates, enable-as-agent)

- `src/pages/Agents.tsx` (new, routed at `/agents` replacing the Step 10 stub): two cards on
  the vendored primitives only (`Card`, `CardHead`, `Button`, `Badge`, `EmptyState`,
  `TableSkeleton`, `ErrorState` — no bespoke styling) — enabled agents (email, `WKdryrun_`
  worker SID in a `.tabular` readout, status `Badge`) and Workspace candidates with an
  Enable button. Data via `@tanstack/react-query` (`useQuery` ×2, `useMutation` +
  invalidation of both keys on success); `QueryClientProvider` added in `src/main.tsx`.
  Each card sits in a labeled `<section>` so tests can scope queries unambiguously.
- `src/lib/api.ts` (new): shared `fetchJson` for the `{ success, data }`/`{ error }`
  envelope. Sets `cache: 'no-store'`.
- **Real bug found by driving the UI** (the server was verified correct first via a direct
  fetch sequence against `wrangler dev`): after Enable, React Query's refetch of
  `/api/agents` could be served the **browser's cached** pre-enable response — API routes
  send no `Cache-Control` header. Symptom: candidate disappears, agent list stays "No
  agents yet". Fix: `cache: 'no-store'` in `fetchJson`.
- **Test-side bug too**: the spec's idempotence branch used `locator.count()`, which does
  NOT auto-wait — against a still-loading page (skeletons) it returned 0 and silently
  skipped the Enable click. Fixed by settling first (`candidateRow.or(agentRow).first()`
  visible) before branching.
- `test/e2e/fixtures/workspace-seed.sql` (new): local-only fixture giving the local
  `WORKSPACE_DB` **emulation** the minimal shape `server/db/workspace.ts` queries
  (departments/resources/sub_skills/resource_sub_skills) plus one candidate for
  `org-step11`. Applied via `wrangler d1 execute skills-foundry-db --local --file=...` —
  never touches the real skills-foundry-db or the sibling repo. (First run surfaced that
  `getResourceSkills` also needs the skills tables — `no such table: resource_sub_skills` —
  so the fixture creates those empty.)
- `test/e2e/agents-page.spec.ts`: DEV_AUTH sign-in → `/agents` → seeded candidate visible →
  Enable → candidate leaves Candidates, appears under Agents as `offline` → screenshot to
  `docs/runs/2026-07-15-phase-3-and-ui/step-11-agents.png` (viewed: agent row with dry-run
  SID readout + offline badge, empty candidates card). Idempotent on rerun (verified: ran
  twice, second run takes the already-enabled path).
- Verified: `npx playwright test` → 4/4 pass on a clean DB (enable flow executed for real).
  Full gate exits 0 (64/64 vitest tests, typecheck, lint, build).
- Commit `28cfbef`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 22:54 — Step 12 done: Queues page (list, create, assign agents)

- `src/pages/Queues.tsx` (new, routed at `/queues` replacing the Step 10 stub), vendored
  primitives only: queue list (name; `WWdryrun_` Workflow SID surfaced in a `.tabular`
  readout **as the plan explicitly requires** — dry-run SIDs visible, not hidden; strategy
  `Badge`), per-queue member roster (accent badges, agent ids mapped to emails via the
  agents query), an assign-agent `<select>` (only unassigned agents offered) + Assign
  button, and a create-queue card. React Query with invalidation on create/assign; labeled
  `<section>`s and `aria-label`ed member lists so tests scope unambiguously (the select and
  the roster can contain the same email text).
- `test/e2e/fixtures/workspace-seed.sql`: extended with an `org-step12` department +
  resource (`bea.candidate@example.com`) so the assign flow has an agent; re-applied to the
  local WORKSPACE_DB emulation (delete-then-insert, idempotent).
- `test/e2e/queues-page.spec.ts`: DEV_AUTH sign-in (org-step12) → enables the seeded
  candidate via the API (`[201, 409]` tolerated so reruns pass) → creates a queue named
  `Support <timestamp>` (unique per run — avoids the org+name UNIQUE constraint on reruns)
  → asserts the row lists with `WWdryrun_` → selects + assigns the agent → asserts the
  member appears in the queue's labeled roster → screenshots to
  `docs/runs/2026-07-15-phase-3-and-ui/step-12-queues.png` (viewed: queues with dry-run
  SIDs in mono readout, `longest-idle` badges, assigned member badge, create card).
- Verified: `npx playwright test` → 5/5 pass (all specs, clean run). Full gate exits 0
  (64/64 vitest tests, typecheck, lint, build).
- Commit `3a96f4a`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 23:00 — Step 13 done: Softphone page (live presence over the DO socket)

- `src/pages/Softphone.tsx` (new): replaces the placeholder `SoftphonePanel` — `src/App.tsx`
  is now purely routes. Behaviour preserved from `src/lib/twilio-voice.ts` (register via
  `/api/token/voice`, status POST to `/api/agents/status`, presence socket), rebuilt on
  vendored primitives with all four register states surfaced for real: registering/
  registered (primary `Button`, accent `Badge` in the card head), **unavailable** (the
  `token 503` path renders an `EmptyState` explaining Twilio API keys are pending —
  presence still works), error (danger `Button` retry). Presence card renders the live
  roster (`aria-label`ed list, accent badge for `available`). Routed at both `/` (nav home)
  and `/softphone` (the plan's verify URL).
- **Real bug found by driving the UI** (second one this arc): `vite.config.ts`'s `/api`
  proxy lacked `ws: true`, so WebSocket upgrades to `/api/realtime/socket` died at the Vite
  origin — the presence roster could never update in dev through the SPA (Steps 3/4 had
  connected straight to :8787, bypassing Vite, so this was invisible until now). Fixed.
- Seed: added `org-step13` + `cara.agent@example.com` (session email must match an enabled
  `cc_agents` row for `/api/agents/status` to accept the change); re-applied.
- `test/e2e/softphone-page.spec.ts`: signs in AS the agent → enables self via API
  (`[201,409]`) → `/softphone` → sets status `available` via the UI select and asserts the
  roster row appears with the badge — a full round-trip (UI → POST → DO broadcast → our
  socket → DOM). Screenshots, then sets `offline` and asserts the row disappears (proves a
  second live update AND leaves the org-step13 DO roster empty, so reruns start clean).
  Screenshot viewed: register button, status Available, roster row
  `cara.agent@example.com · available`.
- Verified: `npx playwright test` → 6/6 pass. Full gate exits 0 (64/64 vitest tests,
  typecheck, lint, build).
- Commit `8f11caa`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.

## 2026-07-15 23:05 — Step 14 done: Wallboard scaffold (live presence, Stat + Card)

- `src/pages/Wallboard.tsx` (new, routed at `/wallboard` — the last Step 10 stub is gone,
  `src/App.tsx` is now routes only): subscribes to the org DO stream
  (`openPresenceSocket`) and renders live presence with vendored `Stat` + `Card` — four
  readouts (online/available/on-call/wrap-up, online accented) and a presence-tile grid
  (identity + status badge on `bg-raised` tiles). **Scaffold only**, exactly the approved
  scope: no monitor/whisper/barge (Phase 5), no call metrics — the Call volume panel
  renders an `EmptyState` saying live call events land in a later phase.
- Seed: added `org-step14` + `dana.agent@example.com`; re-applied.
- `test/e2e/wallboard-page.spec.ts`: signs in as the agent, enables self (`[201,409]`),
  loads `/wallboard`, then changes status **via the API** (per the plan's verify wording)
  while the page is open — the tile can only appear through the live WebSocket, no reload.
  Asserts the tile shows `available`, screenshots to
  `docs/runs/2026-07-15-phase-3-and-ui/step-14-wallboard.png` (viewed: Stat row
  Online 1 / Available 1 / On call 0 / Wrap-up 0, dana's tile with accent badge, Call
  volume EmptyState), then sets `offline` and asserts the tile leaves — cleaning the
  org-step14 DO roster for reruns.
- Housekeeping: full-suite Playwright runs re-screenshot earlier steps' pages; restored the
  committed step-10/12/13 PNGs so each step's archived proof stays as captured at that
  step (only step-14's screenshot is new in this commit).
- Verified: `npx playwright test` → 7/7 pass. Full gate exits 0 (64/64 vitest tests,
  typecheck, lint, build).
- Commit `cf52d90`.
- Push still blocked (`workflow` scope, see Step 1 entry); commits are local.
