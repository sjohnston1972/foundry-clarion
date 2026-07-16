# Foundry Clarion — PROGRESS.md (Run: Phase 4 — recording, transcripts, reporting)

**Goal of this run:** build Phase 4 — capture call recordings into R2, transcribe them with
Cloudflare Workers AI (Whisper), and report over `cc_calls` — entirely under dry-run, with
recording **off by default** and the consent announcement inseparable from recording.

Work order: `PLAN.md` (14 steps, three arcs — Capture, Transcripts, Reporting).
Design and rationale: `docs/superpowers/specs/2026-07-16-phase-4-recording-reporting-design.md`.

**Two rails that cost real money if broken:** `TWILIO_DRY_RUN` and `AI_DRY_RUN` both stay
`"true"` for the whole run. Workers AI has no local simulator — under `wrangler dev` the `AI`
binding proxies to the real API and bills the account.

Append one timestamped entry per completed step below. Do not rewrite history.

---

## 2026-07-16 08:10 — Step 1 done: schema + accessors for org settings and recordings

- Read the design spec (`docs/superpowers/specs/2026-07-16-phase-4-recording-reporting-design.md`)
  in full before touching anything, per the plan's instruction.
- `migrations/0004_recordings.sql`: `cc_org_settings` (`recording_enabled INTEGER NOT NULL
  DEFAULT 0` — the consent default is DDL) and `cc_recordings` (org-scoped by column — the
  deliberate deviation from design §4 the plan documents; unique on org+`twilio_recording_sid`,
  FK to `cc_calls` `ON DELETE CASCADE`, `transcript_status` defaulting `'pending'`, indexed
  by org and call).
- `server/db/settings.ts` (verbatim from the plan): `getOrgSettings` returns
  `recordingEnabled: false` for an absent row — never create-on-read; `upsertOrgSettings`
  with conflict-update; `DEFAULT_ANNOUNCEMENT` exported for Step 3.
- `server/db/recordings.ts` mirroring `server/db/calls.ts`: `Recording`,
  `TranscriptStatus = 'pending'|'done'|'failed'|'skipped'`, `insertRecording`,
  `getRecordingById(db, orgId, id)`, `listRecordingsForCall(db, orgId, callId)`,
  `setTranscript(db, orgId, id, …)` — every query filtered by `organization_id`.
- Tests (10 new, all required cases present): `test/recordings-migration.test.ts` (tables,
  the `DEFAULT 0` consent posture, org unique + FK, pending default);
  `test/settings-db.test.ts` (**default off** on absent row + still absent after read;
  upsert round-trips both fields, idempotent on conflict, partial patch keeps the other
  field, explicit null clears; cross-tenant); `test/recordings-db.test.ts` (insert/read/list;
  **cross-tenant leak**: org B cannot `getRecordingById` org A's recording; `setTranscript`
  org-scoped — a cross-org update is a no-op).
- Verified: `npm run d1:migrate:local` applied `0004_recordings.sql` cleanly (6 commands, ✅).
  Gate exits 0 (74/74 tests across 24 files, typecheck, lint, build).
- Commit `cfd19cb`. **Pushed to origin successfully** — the Phase 3 push blocker is
  confirmed resolved (`989babc..cfd19cb`).

## 2026-07-16 08:13 — Step 2 done: R2 + Workers AI bindings behind the `AI_DRY_RUN` rail

- `wrangler.jsonc`: added `r2_buckets` (`RECORDINGS` → `foundry-clarion-recordings`),
  `"ai": { "binding": "AI" }`, and extended `vars` to include `"AI_DRY_RUN": "true"`. No
  cloud bucket created — Miniflare provides R2 locally, per the run invariants.
- `server/types.ts`: `RECORDINGS: R2Bucket`, `AI: Ai`, `AI_DRY_RUN?: string` added to
  `Bindings`, with the plan's cost-rail comments verbatim.
- Verified: `npm run typecheck:server` exits 0. `npx wrangler dev --port 8787` boots with
  the new bindings visible — `env.RECORDINGS … R2 Bucket local`, **`env.AI … AI remote`**,
  `env.AI_DRY_RUN ("true")` — and wrangler's own boot warning confirms the rail's premise
  verbatim: "AI bindings always access remote resources, and so may incur usage charges
  even in local dev." `GET /api/health` → 200; server stopped cleanly.
  `git grep -n '"AI_DRY_RUN"' wrangler.jsonc` → `"true"`. Full gate exits 0 (74/74 tests,
  typecheck, lint, build).
- No Workers AI call was made (the binding was never invoked; only `/api/health` was hit).
- Commit `d62eb6d`, pushed to origin (`88fcff5..d62eb6d`).

## 2026-07-16 08:17 — Step 3 done: the consent invariant (announcement TwiML)

- `server/routes/voice.ts` `POST /inbound`: after resolving the queue, reads
  `getOrgSettings` and prepends `<Say>{announcementText ?? DEFAULT_ANNOUNCEMENT}</Say>`
  (XML-escaped) **only** when `recordingEnabled` — exactly the plan's snippet, with a
  comment naming the invariant and its date so the code carries the decision.
- Recording off ⇒ TwiML byte-for-byte the Phase 3 shape: the five existing voice-route
  assertions pass **untouched** (verified — no edits to them).
- `test/voice-route.test.ts`: `fakeDb()` gained a `cc_org_settings` branch (parameterized
  per test, following the existing `cc_queues` branch); `env()` passes it through. Three
  new cases in a dedicated describe:
  (a) test named exactly `consent invariant: recording off => no announcement, no
  recording` — covers **both** explicit `recording_enabled = 0` and the absent-row default,
  asserting no `<Say>` and the exact Phase 3 `<Response><Enqueue …` shape;
  (b) enabled with org wording ⇒ `<Say>Custom org announcement.</Say>` and the `<Say>`
  precedes `<Enqueue>`;
  (c) enabled with `announcement_text = NULL` ⇒ `<Say>` carries `DEFAULT_ANNOUNCEMENT`.
- Verified: `npx vitest run test/voice-route.test.ts` → 8/8 (5 Phase 3 + 3 new). Gate exits
  0 (77/77 tests, typecheck, lint, build).
- Commit `29e2325`, pushed to origin (`e1dc768..29e2325`).

## 2026-07-16 12:34 — Step 4 done: start recording on the in-progress leg (dry-run)

- `server/lib/twilio/provisioning.ts`: added `API_BASE` and `startCallRecording` verbatim
  from the plan — dry-run returns a deterministic `REdryrun_<uuid>` with no network; the
  live path (POST `/2010-04-01/Accounts/{sid}/Calls/{callSid}/Recordings.json` with
  `RecordingStatusCallback`) is written but unreachable while `TWILIO_DRY_RUN !== 'false'`.
- `server/routes/voice.ts` `POST /status`: when `CallStatus === 'in-progress'` **and**
  `getOrgSettings(...).recordingEnabled`, starts the recording — wrapped in try/catch so a
  failure never fails the webhook (mirroring `pushPresence`'s non-fatal posture). Callback
  URL = the request's own URL with pathname swapped to `/api/voice/recording`, preserving
  `?orgId=&queueId=` for Step 5.
- `test/voice-route.test.ts`: the provisioning module is now spy-wrapped via `vi.mock` +
  `importOriginal` — the real dry-run implementation still runs, but invocations are
  observable. Three new tests: disabled/unconfigured ⇒ `startCallRecording` never called;
  enabled ⇒ called once, callback pathname `/api/voice/recording` with `orgId=o1`, result a
  `REdryrun_` SID with `dryRun: true`, and a stubbed `fetch` proves **no call to
  `api.twilio.com`** escapes; a non-`in-progress` status never starts recording even when
  enabled. (Cleaned up one duplicated missing-signature test my edit initially introduced —
  caught on read-back before committing.)
- Verified: `npx vitest run test/voice-route.test.ts` → 11/11. Gate exits 0 (80/80 tests,
  typecheck, lint, build). `git grep -n "TWILIO_DRY_RUN" wrangler.jsonc` → still `"true"`.
- Commit `5170882`, pushed to origin (`daca11b..5170882`).

## 2026-07-16 12:38 — Step 5 done: LINCHPIN — `recordingStatusCallback` → R2, green first try

- `server/lib/twilio/provisioning.ts`: `fetchRecordingMedia` verbatim from the plan —
  dry-run returns synthetic bytes (`dryrun-audio:<sid>`) with no network; **the R2 write
  stays real**, so capture is genuinely exercised rather than mocked away. Live path
  (authenticated GET of `RecordingUrl`) written but unreachable.
- `server/routes/voice.ts` `POST /recording` verbatim from the plan: signature-validated
  first, outside the AuthPak gate like its siblings; `orgId` required; non-`completed`
  statuses ⇒ 204 no-op; unknown `CallSid` ⇒ 404; on `completed` ⇒ media fetched, put at
  `orgs/{orgId}/calls/{callSid}/{recordingSid}.mp3`, `cc_recordings` row inserted
  (metadata in D1, bytes in R2 only), 204. The trailing comment marks where Step 7's
  `waitUntil` hand-off lands.
- `test/voice-route.test.ts`: added the plan's `fakeR2` beside `fakeDb` (store exposed),
  gave `fakeDb` a `cc_recordings` INSERT branch + a typed `recordingsStore` handle, and
  `env()` now carries a `RECORDINGS` bucket (per-test injectable). Four new tests, all four
  required cases: missing/invalid signature ⇒ 403; non-`completed` ⇒ 204 with **nothing**
  written (empty R2 store, no row); `completed` ⇒ 204 with exactly the key
  `orgs/o1/calls/CAdryrun_1/REdryrun_x.mp3` in R2, decoded bytes `dryrun-audio:REdryrun_x`,
  and a `cc_recordings` row (`duration_s` 42, `transcript_status` 'pending'); unknown
  `CallSid` ⇒ 404. The `cc_calls` row is seeded through the real status webhook on the same
  env, not injected.
- Verified: `npx vitest run test/voice-route.test.ts` → 15/15 **on the first attempt** —
  the stop-the-run rail was never approached. Gate exits 0 (84/84 tests, typecheck, lint,
  build).
- Commit `580f224`, pushed to origin (`53703ef..580f224`).

## 2026-07-16 12:41 — Step 6 done: `transcribeAudio` behind `AI_DRY_RUN`

- `server/lib/ai/transcribe.ts` (verbatim from the plan): `Transcript`, `isAiDryRun`
  (anything but the exact string `'false'` is dry — same posture as `isDryRun`), and
  `transcribeAudio` — stub transcript under the rail; the live
  `env.AI.run('@cf/openai/whisper', { audio: [...] })` path written but unreachable.
  Mirrors the provisioning dry-run shape; no second pattern invented.
- `test/transcribe.test.ts` (3 tests): the fake `AI`'s `run` **throws if invoked** — the
  cost-rail assertion the plan requires. `AI_DRY_RUN` unset ⇒ stub returned, `run` proven
  never called; `'true'` ⇒ same; `'false'` with a benign fake ⇒ the fake's text returned
  with model `@cf/openai/whisper`, called exactly once, and the audio arrives as the
  number-array input shape with the right length.
- Verified: `npx vitest run test/transcribe.test.ts` → 3/3. Gate exits 0 (87/87 tests,
  typecheck, lint, build). `git grep -n '"AI_DRY_RUN"' wrangler.jsonc` → still `"true"`.
  **No Workers AI call was made at any point** (the only `AI` objects that exist in tests
  are fakes; the real binding was never invoked).
- Commit `d9e97d1`, pushed to origin (`d02a468..d9e97d1`).

## 2026-07-16 17:34 — Step 7 done: transcription wired into the webhook via `waitUntil`

- `server/lib/ai/transcribe.ts`: added `transcribeRecording` verbatim from the plan — R2 →
  Whisper → R2 + `cc_recordings`, **never throws**: a missing R2 object or a failing
  provider sets `transcript_status='failed'` and returns; the recording row and its
  `r2_key` are never touched by failure.
- `server/routes/voice.ts` `POST /recording`: the Step 5 trailing comment replaced with
  `c.executionCtx.waitUntil(transcribeRecording(...))` before the 204 — Twilio never waits
  on Whisper.
- `test/voice-route.test.ts`: `postRecording` now supplies a fake `ExecutionContext`
  (collecting handed-off promises — Hono's `c.executionCtx` throws without one); `fakeDb`
  gained the `UPDATE cc_recordings` branch (`setTranscript`). The completed-callback test
  proves the ordering: 204 returned while the row is still un-transcribed, then awaiting
  the collected promise lands `transcript_status='done'` + the `.transcript.json` object in
  R2. Three direct `transcribeRecording` tests per the plan: success ⇒ `'done'`, key ends
  `.transcript.json`, transcript JSON in the fake store (`[dry-run transcript]`,
  `dryRun: true`); throwing `transcribeAudio` (via `AI_DRY_RUN='false'` + a throwing fake
  `AI` — the real catch path, not a shortcut) ⇒ `'failed'`, `transcript_r2_key` null, row +
  `r2_key` + audio object intact; missing R2 object ⇒ `'failed'`, resolves without throwing.
- Verified: `npx vitest run test/voice-route.test.ts` → 18/18 (the stderr stack trace in
  the run is the throwing-AI test's *expected* `console.error`). Gate exits 0 (90/90 tests,
  typecheck, lint, build). No Workers AI call was made (only fakes).
- Commit `3227919`, pushed to origin (`b266bb6..3227919`).

## 2026-07-16 17:38 — Step 8 done: settings API (admin-gated, audited)

- `server/routes/settings.ts` (new), following `server/routes/queues.ts` exactly:
  `GET /api/settings` returns `getOrgSettings` (the default-off posture reaches the API
  surface); `PATCH /api/settings` validates `{ recordingEnabled?: boolean;
  announcementText?: string | null }` — non-boolean `recordingEnabled` ⇒ `bad_input` 400,
  `announcementText` must be string or null — then `upsertOrgSettings`. Both verbs
  `requireClarionRole('admin')`. Every successful PATCH writes an `insertAuditLog` row
  (`action: 'settings.update'` with the resulting state in `meta_json`).
- Mounted **inside** the AuthPak gate in `server/app.ts` (`app.route('/settings',
  settings)`), after the gate middleware like `/queues`.
- `test/settings-route.test.ts` (5 tests, mirroring the queues-route mock/fakeDb pattern,
  with the settings + audit stores exposed for assertions): agent ⇒ 403 on **both** verbs;
  supervisor ⇒ 403 on PATCH; admin GET ⇒ 200 with
  `{ organizationId, recordingEnabled: false, announcementText: null }` for an
  unconfigured org; PATCH round-trips through a subsequent GET **and** the audit row is
  asserted (org, user `u-admin`, action, parsed `meta_json`); non-boolean
  `recordingEnabled` ⇒ 400 `bad_input` with **no** audit row written.
- Verified: `npx vitest run test/settings-route.test.ts` → 5/5. Gate exits 0 (95/95 tests,
  typecheck, lint, build).
- Commit `e2f6d7b`, pushed to origin (`ec11a22..e2f6d7b`).

## 2026-07-16 22:33 — Step 9 done: reports API (filters + aggregates)

- `server/db/calls.ts`: added `CallFilter`, `CallSummary`, `whereFor` (WHERE built from
  bound values only — column names never interpolated), `queryCalls` (`started_at DESC
  LIMIT 500`) and `summarizeCalls` (COUNT/answered/abandoned via `agent_id` presence,
  `COALESCE(AVG(duration_s), 0)` rounded) — all verbatim from the plan, keeping raw SQL out
  of handlers per CLAUDE.md §10.
- `server/routes/reports.ts` (new): `GET /api/reports/calls`,
  `requireClarionRole('supervisor')`, reads the five filters from the query string
  (empty-string query values normalised to `undefined` so they don't bind as filters),
  returns `{ success: true, data: { calls, summary } }`. Mounted inside the gate.
- `test/reports-route.test.ts` (4 tests): the fake D1 interprets exactly the clause strings
  `whereFor` emits against rows seeded across two orgs (o2's call deliberately reuses o1's
  queue id). Agent ⇒ 403; supervisor ⇒ 200, 3 rows, summary
  `{ total: 3, answered: 2, abandoned: 1, avgDurationS: 45 }` (AVG ignores the NULL
  duration — the fake mimics SQL semantics); each of the five filters narrows the set, plus
  a combined queueId+disposition case with its own summary arithmetic; **cross-tenant** —
  an org B session passing org A's `queueId` returns only org B's call (`c4`), never org
  A's rows, and its summary counts only org B.
- Verified: `npx vitest run test/reports-route.test.ts` → 4/4. Gate exits 0 (99/99 tests,
  typecheck, lint, build).
- Commit `a4fab4a`, pushed to origin (`1fceb4f..a4fab4a`).

## 2026-07-16 22:37 — Step 10 done: recording media + transcript endpoints

- `server/routes/recordings.ts` (new): `GET /api/recordings/:id/media` (plan snippet
  verbatim — R2 stream, `audio/mpeg`, `cache-control: private, no-store`) and
  `GET /:id/transcript` (same shape; 404 while `transcript_r2_key` is null; JSON with the
  same no-store header). Both `requireClarionRole('supervisor')`. Cross-org reads are
  **404, never 403** — deliberate, a 403 would confirm the id exists. Mounted inside the
  gate (`app.route('/recordings', recordings)`).
- `test/recordings-route.test.ts` (5 tests; two seeded o1 recordings — one transcribed, one
  pending — plus a seeded fake R2): agent ⇒ 403 on both endpoints; supervisor media ⇒ 200
  `audio/mpeg` + `private, no-store` + exact body; **cross-tenant**: an org B supervisor
  fetching org A's recording id ⇒ 404 on both media and transcript; pending transcript ⇒
  404; done transcript ⇒ 200 `application/json` with the stored transcript JSON.
- Verified: `npx vitest run test/recordings-route.test.ts` → 5/5. Gate exits 0 (104/104
  tests, typecheck, lint, build).
- Commit `add90b6`, pushed to origin (`b8e40f2..add90b6`).
