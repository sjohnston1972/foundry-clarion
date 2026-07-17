# Foundry Clarion — PLAN.md (Run: Phase 4 — recording, transcripts, reporting)

Autonomous-run work order. One small, commit-able step per turn, each ending in a check you
can actually run. Commit **and push** after each step, then append a timestamped line to
`PROGRESS.md`.

**Goal of this run, in one sentence:** build Phase 4 — capture call recordings into R2,
transcribe them with Workers AI, and report over `cc_calls` — entirely under dry-run, with
recording **off by default** and the consent announcement inseparable from recording.

**Why this run exists:** Phase 3 landed queues, inbound TwiML, and `cc_calls`, but a call
leaves no artifact behind: no audio, no transcript, no report. Phase 4 was the one phase the
roadmap gated on a decision only Steven could make (`docs/design/foundry-clarion-design.md`
§9, "Gated on: Recording-consent product decision (yours)"). **That gate is now cleared** —
see Invariants. Full design and rationale:
`docs/superpowers/specs/2026-07-16-phase-4-recording-reporting-design.md`. **Read it before
Step 1**; it records which options were rejected and why, which will save you from
"improving" a deliberate choice.

**Decision authority:** Steven approved this run's scope, the consent posture, Workers AI as
the transcription provider, the `waitUntil` pipeline, and the branch, in-session on
2026-07-16. **Do not re-open those decisions; do not extend them.**

**Preconditions (already true — verify, don't redo):** PR #1 is merged; `main` contains all
Phase 3 work; this run's branch `feat/clarion-phase-4-recording` is cut from that `main`. All
prior work is pushed — the Phase 3 push blocker is **resolved** (its real cause was that
`main` had never been pushed, dragging `ed33e99`, which creates `ci.yml`, into every push;
that commit is now on the remote, so ordinary pushes work).

---

## The consent decision (read once, then let the code carry it)

Steven decided, 2026-07-16:

> **Recording is off by default. When an org enables it, an announcement plays to the caller
> and cannot be disabled separately.**

This is not a preference to be implemented loosely. It appears in this run three times, and
all three are required:

1. `cc_org_settings.recording_enabled INTEGER NOT NULL DEFAULT 0` — the default is DDL.
2. `getOrgSettings` returns `recordingEnabled: false` for an **absent row**. Never
   create-on-read, never default-on. A tenant that has never been configured records nothing.
3. **There is no independent announcement toggle.** The announcement is a function of
   `recording_enabled`. Do not add a second switch, however reasonable it looks — that is the
   exact failure this design forecloses (an org recording silently).

Step 3 pins this as an executable test. Prose rots; assertions do not.

---

## Invariants (apply to EVERY step)

- Package manager **npm**. **No `any`.** `organization_id` / `user_id` are TEXT.
- Success envelope `{ success, data }`; errors `{ error: { code, message } }`.
- Branch **`feat/clarion-phase-4-recording`** only. **Never commit to `main`.** Do not create
  branches. Push after every step; if push fails, note it in `PROGRESS.md` and carry on.
- **Never write to `WORKSPACE_DB`** (read-only bind). Every query filters by `organization_id`.
- **Never commit in `authpak/` or `skills-foundry/`.** Read-only, always (CLAUDE.md §4).
- Secrets never reach the frontend bundle.
- `TWILIO_DRY_RUN` stays `"true"`. **Do not flip it. No Twilio account mutation of any kind.**
- `AI_DRY_RUN` stays `"true"`. **Do not flip it.** See the rail below — this one spends money.
- **No Cloudflare account change.** `wrangler dev` allowed; `wrangler deploy` is not. **Do not
  create the R2 bucket in the cloud** — Miniflare provides it locally.
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

- **`AI_DRY_RUN` is a cost rail, not a convenience.** Workers AI has **no local simulator**:
  under `wrangler dev` the `AI` binding proxies to the **real** API and bills the account.
  `AI_DRY_RUN` defaults to `"true"` and stays there. If you find yourself wanting a "real"
  transcript to prove the code works, **that is the moment to stop**, not the moment to flip
  it. Step 6's test asserts no `AI.run` escapes.
- **Step 5 is the linchpin.** It is the first step where a recording actually reaches R2. If it
  cannot go green after one honest attempt, **stop** and end the run — Arc B and Arc C are
  both built on it and are meaningless without it.
- **Playwright fallback.** If the browser download fails, note it in `PROGRESS.md`, fall back
  to `@testing-library/react` + `jsdom` for component assertions plus a `fetch` check on the
  served HTML, and carry on. **Never claim UI verification that did not happen.**
- **`@cloudflare/vitest-pool-workers` is still broken on Windows** (EBUSY on the DO sqlite —
  the last run's Step 2 rail). Unchanged and **not this run's problem**. Do not try to fix it.
  Do not downgrade vitest.
- **Hard stops.** If any Twilio call would go live, **stop**. If any Workers AI call would go
  live, **stop**. If a step needs a decision from Steven, **stop**: write the question under
  Blockers in `PROGRESS.md` and end the run.
- Arcs are ordered so a dead run dies at a coherent boundary. Do not reorder them.

---

## Steps

### Arc A — Capture

1. **Schema + accessors: org settings and recordings.**
   Create `migrations/0004_recordings.sql`:

   ```sql
   -- 0004_recordings.sql — Foundry Clarion org settings + recording metadata.
   -- Recording is OFF by default (Steven, 2026-07-16): the default is DDL, not app logic.
   PRAGMA foreign_keys = ON;

   CREATE TABLE cc_org_settings (
     organization_id   TEXT PRIMARY KEY,
     recording_enabled INTEGER NOT NULL DEFAULT 0,
     announcement_text TEXT,
     updated_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
   );

   CREATE TABLE cc_recordings (
     id                   TEXT PRIMARY KEY,
     organization_id      TEXT NOT NULL,
     call_id              TEXT NOT NULL REFERENCES cc_calls(id) ON DELETE CASCADE,
     twilio_recording_sid TEXT NOT NULL,
     r2_key               TEXT NOT NULL,
     duration_s           INTEGER,
     transcript_r2_key    TEXT,
     transcript_status    TEXT NOT NULL DEFAULT 'pending',
     created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
     UNIQUE (organization_id, twilio_recording_sid)
   );
   CREATE INDEX idx_cc_recordings_org  ON cc_recordings(organization_id);
   CREATE INDEX idx_cc_recordings_call ON cc_recordings(call_id);
   ```

   `organization_id` on `cc_recordings` is a **deliberate deviation** from design §4, which
   reaches org via `call_id`. CLAUDE.md §6 requires every row to be org-scoped, and it makes
   the leak test a direct assertion. Step 13 updates the design doc — do not "correct" it back.

   Create `server/db/settings.ts`, mirroring the shape of `server/db/queues.ts`:

   ```ts
   export type OrgSettings = { organizationId: string; recordingEnabled: boolean; announcementText: string | null }
   export const DEFAULT_ANNOUNCEMENT = 'This call may be recorded for quality and training purposes.'

   type SettingsRow = { organization_id: string; recording_enabled: number; announcement_text: string | null }

   /** Absent row => recording OFF. Never create-on-read: an unconfigured org records nothing. */
   export async function getOrgSettings(db: D1Database, orgId: string): Promise<OrgSettings> {
     const row = await db
       .prepare(`SELECT organization_id, recording_enabled, announcement_text FROM cc_org_settings WHERE organization_id = ?`)
       .bind(orgId)
       .first<SettingsRow>()
     if (!row) return { organizationId: orgId, recordingEnabled: false, announcementText: null }
     return { organizationId: row.organization_id, recordingEnabled: row.recording_enabled === 1, announcementText: row.announcement_text }
   }

   export async function upsertOrgSettings(
     db: D1Database, orgId: string, patch: { recordingEnabled?: boolean; announcementText?: string | null },
   ): Promise<OrgSettings> {
     const cur = await getOrgSettings(db, orgId)
     const next = {
       recordingEnabled: patch.recordingEnabled ?? cur.recordingEnabled,
       announcementText: patch.announcementText === undefined ? cur.announcementText : patch.announcementText,
     }
     await db
       .prepare(`INSERT INTO cc_org_settings (organization_id, recording_enabled, announcement_text, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(organization_id) DO UPDATE SET
                   recording_enabled = excluded.recording_enabled,
                   announcement_text = excluded.announcement_text,
                   updated_at = CURRENT_TIMESTAMP`)
       .bind(orgId, next.recordingEnabled ? 1 : 0, next.announcementText)
       .run()
     return { organizationId: orgId, ...next }
   }
   ```

   Create `server/db/recordings.ts` with `Recording`, `TranscriptStatus =
   'pending' | 'done' | 'failed' | 'skipped'`, and `insertRecording`, `getRecordingById(db,
   orgId, id)`, `listRecordingsForCall(db, orgId, callId)`, `setTranscript(db, orgId, id,
   { transcriptR2Key, transcriptStatus })` — every query filtered by `organization_id`,
   mirroring `server/db/calls.ts`.

   Tests `test/recordings-migration.test.ts` (mirror `test/queues-migration.test.ts`),
   `test/settings-db.test.ts`, `test/recordings-db.test.ts` — required cases:
   (a) **default off**: `getOrgSettings` on an org with no row returns `recordingEnabled: false`;
   (b) `upsertOrgSettings` round-trips both fields and is idempotent on conflict;
   (c) **cross-tenant leak**: org B cannot `getRecordingById` a recording belonging to org A.
   **Verify:** `npm run d1:migrate:local` applies `0004` cleanly; `npx vitest run` passes; gate 0.

2. **Bindings: R2, Workers AI, and the `AI_DRY_RUN` rail.**
   In `wrangler.jsonc` add, alongside the existing `d1_databases`:

   ```jsonc
   "r2_buckets": [ { "binding": "RECORDINGS", "bucket_name": "foundry-clarion-recordings" } ],
   "ai": { "binding": "AI" },
   ```

   and extend `vars` to `{ "AUTH_ENFORCE": "false", "TWILIO_DRY_RUN": "true", "AI_DRY_RUN": "true" }`.
   In `server/types.ts` add to `Bindings`:

   ```ts
   /** Recording audio + transcripts. Metadata lives in D1; bytes never do. */
   RECORDINGS: R2Bucket
   /** Workers AI (Whisper). NO local simulator — see AI_DRY_RUN. */
   AI: Ai
   /** When 'true' (default), Whisper is stubbed and NO Workers AI call is made.
    *  wrangler dev proxies AI to the REAL API and bills the account. Do not flip this. */
   AI_DRY_RUN?: string
   ```

   **Verify:** `npm run typecheck:server` exits 0; `npx wrangler dev --port 8787` boots and
   `GET /api/health` → 200 (stop it cleanly afterwards); `git grep -n '"AI_DRY_RUN"'
   wrangler.jsonc` → shows `"true"`.

3. **The consent invariant: the announcement.**
   In `server/routes/voice.ts`, `POST /inbound` reads settings and prepends the announcement
   **only** when recording is enabled:

   ```ts
   const settings = await getOrgSettings(c.env.DB, orgId)
   const say = settings.recordingEnabled
     ? `<Say>${escapeXml(settings.announcementText ?? DEFAULT_ANNOUNCEMENT)}</Say>`
     : ''
   return twiml(`<Response>${say}<Enqueue workflowSid="${queue.twilioWorkflowSid}"><Task>${task}</Task></Enqueue></Response>`)
   ```

   With recording off, the TwiML must be **byte-for-byte** what Phase 3 emits today — the
   existing assertions in `test/voice-route.test.ts` must still pass untouched.
   Extend `test/voice-route.test.ts` with the **consent invariant** (name the test exactly
   `consent invariant: recording off => no announcement, no recording`):
   (a) `recording_enabled = 0` ⇒ TwiML contains **no** `<Say>`;
   (b) `recording_enabled = 1` ⇒ TwiML contains `<Say>` with the org's text;
   (c) `recording_enabled = 1` with `announcement_text = NULL` ⇒ `<Say>` contains
   `DEFAULT_ANNOUNCEMENT`.
   The existing `fakeDb()` in that file needs a `cc_org_settings` branch — extend it, following
   the `cc_queues` branch already there.
   **Verify:** `npx vitest run test/voice-route.test.ts` → all pass including the three new
   cases and the untouched Phase 3 ones; gate 0.

4. **Start recording on the in-progress leg (dry-run).**
   Add to `server/lib/twilio/provisioning.ts`, following the **existing** `isDryRun` pattern at
   line 5 exactly:

   ```ts
   const API_BASE = 'https://api.twilio.com/2010-04-01'

   /** Start recording an in-progress call leg. DRY_RUN => deterministic fake SID, no network. */
   export async function startCallRecording(
     env: Bindings, args: { callSid: string; recordingStatusCallback: string },
   ): Promise<{ recordingSid: string; dryRun: boolean }> {
     if (isDryRun(env)) {
       return { recordingSid: `REdryrun_${crypto.randomUUID().replace(/-/g, '')}`, dryRun: true }
     }
     // LIVE PATH — only reached after Steven flips TWILIO_DRY_RUN=false in-session.
     const auth = authHeader(env)
     const body = new URLSearchParams({
       RecordingStatusCallback: args.recordingStatusCallback,
       RecordingStatusCallbackEvent: 'completed',
     })
     const res = await fetch(`${API_BASE}/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${args.callSid}/Recordings.json`, {
       method: 'POST',
       headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' },
       body,
     })
     if (!res.ok) throw new Error(`Twilio startCallRecording failed: ${res.status} ${await res.text()}`)
     const json = (await res.json()) as { sid: string }
     return { recordingSid: json.sid, dryRun: false }
   }
   ```

   In `POST /status`, when `CallStatus === 'in-progress'` and recording is enabled, start it —
   **best-effort**, mirroring how `pushPresence` was made non-fatal in Phase 3 (a recording
   failure must never fail the status webhook):

   ```ts
   if (params.CallStatus === 'in-progress') {
     const settings = await getOrgSettings(c.env.DB, orgId)
     if (settings.recordingEnabled) {
       const cb = new URL(c.req.url)
       cb.pathname = '/api/voice/recording'   // keeps ?orgId=&queueId=
       try {
         await startCallRecording(c.env, { callSid, recordingStatusCallback: cb.toString() })
       } catch (e) {
         console.error('startCallRecording failed', e)
       }
     }
   }
   ```

   Tests in `test/voice-route.test.ts`: recording **not** started when disabled; started when
   enabled; the callback URL carries `orgId`; **an assertion that no `fetch` to
   `api.twilio.com` occurs** (mirror the `taskrouter.twilio.com` assertion in
   `test/queues-route.test.ts`).
   **Verify:** `npx vitest run test/voice-route.test.ts` passes; gate 0;
   `git grep -n "TWILIO_DRY_RUN" wrangler.jsonc` still shows `"true"`.

5. **LINCHPIN — `recordingStatusCallback` → R2.**
   Add to `server/lib/twilio/provisioning.ts`:

   ```ts
   /** Fetch recording audio. DRY_RUN => synthetic bytes, no network. The R2 write is still real. */
   export async function fetchRecordingMedia(
     env: Bindings, args: { recordingSid: string; mediaUrl: string },
   ): Promise<ArrayBuffer> {
     if (isDryRun(env)) {
       return new TextEncoder().encode(`dryrun-audio:${args.recordingSid}`).buffer as ArrayBuffer
     }
     // LIVE PATH — only reached after Steven flips TWILIO_DRY_RUN=false in-session.
     const res = await fetch(args.mediaUrl, { headers: { Authorization: authHeader(env) } })
     if (!res.ok) throw new Error(`Twilio fetchRecordingMedia failed: ${res.status}`)
     return await res.arrayBuffer()
   }
   ```

   Add `POST /recording` to `server/routes/voice.ts` — signature-validated, **outside** the
   AuthPak gate like its siblings (it is already mounted via `app.route('/voice', voice)`):

   ```ts
   voice.post('/recording', async (c) => {
     const params = await parseFormParams(c.req.raw)
     const signature = c.req.header('X-Twilio-Signature')
     if (!(await isValidTwilioSignature(c.env.TWILIO_AUTH_TOKEN, c.req.url, params, signature ?? null))) {
       return err(c, 'bad_signature', 'Invalid Twilio signature', 403)
     }
     const orgId = c.req.query('orgId')
     if (!orgId) return err(c, 'bad_input', 'orgId is required', 400)
     if ((params.RecordingStatus ?? '') !== 'completed') return c.body(null, 204)

     const callSid = params.CallSid
     const recordingSid = params.RecordingSid
     if (!callSid || !recordingSid) return err(c, 'bad_input', 'CallSid and RecordingSid are required', 400)

     const call = await getCallBySid(c.env.DB, orgId, callSid)
     if (!call) return err(c, 'not_found', 'Call not found', 404)

     const key = `orgs/${orgId}/calls/${callSid}/${recordingSid}.mp3`
     const bytes = await fetchRecordingMedia(c.env, { recordingSid, mediaUrl: params.RecordingUrl ?? '' })
     await c.env.RECORDINGS.put(key, bytes)

     const id = crypto.randomUUID()
     await insertRecording(c.env.DB, {
       id, organizationId: orgId, callId: call.id, twilioRecordingSid: recordingSid, r2Key: key,
       durationS: params.RecordingDuration ? Number(params.RecordingDuration) : null,
     })
     return c.body(null, 204)   // Step 7 adds the waitUntil transcription hand-off here.
   })
   ```

   Tests in `test/voice-route.test.ts` need a fake R2 — add it beside the existing `fakeDb()`:

   ```ts
   function fakeR2() {
     const store = new Map<string, ArrayBuffer>()
     return {
       bucket: {
         put: async (k: string, v: ArrayBuffer) => { store.set(k, v); return {} },
         get: async (k: string) => store.has(k)
           ? { arrayBuffer: async () => store.get(k)!, body: null }
           : null,
       } as unknown as R2Bucket,
       store,
     }
   }
   ```

   Required cases: missing/invalid signature ⇒ 403; a non-`completed` status ⇒ 204 with
   **nothing** written; a `completed` callback ⇒ 204, `store` has the key
   `orgs/o1/calls/CAdryrun_1/REdryrun_x.mp3`, and a `cc_recordings` row exists; an unknown
   `CallSid` ⇒ 404.
   **Verify:** `npx vitest run test/voice-route.test.ts` passes; gate 0.
   **If this cannot go green after one honest attempt, STOP and end the run.**

### Arc B — Transcripts

6. **`transcribeAudio` behind `AI_DRY_RUN`.**
   Create `server/lib/ai/transcribe.ts`, mirroring the dry-run shape of
   `server/lib/twilio/provisioning.ts` — do not invent a second pattern:

   ```ts
   import type { Bindings } from '../../types'

   export type Transcript = { text: string; model: string; dryRun: boolean }

   export function isAiDryRun(env: Bindings): boolean {
     return env.AI_DRY_RUN !== 'false'
   }

   /** Whisper over recording audio. DRY_RUN => stub, NO Workers AI call (it bills real money). */
   export async function transcribeAudio(env: Bindings, audio: ArrayBuffer): Promise<Transcript> {
     if (isAiDryRun(env)) {
       return { text: '[dry-run transcript]', model: 'dryrun', dryRun: true }
     }
     // LIVE PATH — only reached after Steven flips AI_DRY_RUN=false in-session.
     const res = (await env.AI.run('@cf/openai/whisper', {
       audio: [...new Uint8Array(audio)],
     })) as { text?: string }
     return { text: res.text ?? '', model: '@cf/openai/whisper', dryRun: false }
   }
   ```

   Tests `test/transcribe.test.ts`: with `AI_DRY_RUN` unset ⇒ stub returned and the `AI`
   binding's `run` is **never called** (pass a fake `AI` whose `run` throws if invoked — that
   is the assertion); with `AI_DRY_RUN: 'false'` and a fake `AI` ⇒ the fake's text is returned.
   **Verify:** `npx vitest run test/transcribe.test.ts` passes; gate 0;
   `git grep -n '"AI_DRY_RUN"' wrangler.jsonc` → still `"true"`.

7. **Wire transcription into the webhook via `waitUntil`.**
   Add to `server/lib/ai/transcribe.ts` the orchestration — **it must never throw**, because a
   lost transcript must not lose the recording:

   ```ts
   /** R2 -> Whisper -> R2 + cc_recordings. Never throws: failure sets transcript_status='failed'. */
   export async function transcribeRecording(
     env: Bindings, opts: { orgId: string; recordingId: string; r2Key: string },
   ): Promise<void> {
     try {
       const obj = await env.RECORDINGS.get(opts.r2Key)
       if (!obj) {
         await setTranscript(env.DB, opts.orgId, opts.recordingId, { transcriptR2Key: null, transcriptStatus: 'failed' })
         return
       }
       const transcript = await transcribeAudio(env, await obj.arrayBuffer())
       const key = `${opts.r2Key.replace(/\.mp3$/, '')}.transcript.json`
       await env.RECORDINGS.put(key, JSON.stringify(transcript))
       await setTranscript(env.DB, opts.orgId, opts.recordingId, { transcriptR2Key: key, transcriptStatus: 'done' })
     } catch (e) {
       console.error('transcribeRecording failed', e)
       await setTranscript(env.DB, opts.orgId, opts.recordingId, { transcriptR2Key: null, transcriptStatus: 'failed' })
     }
   }
   ```

   In `POST /recording` (Step 5), replace the trailing comment with the hand-off **before**
   returning — Twilio must never wait on Whisper:

   ```ts
   c.executionCtx.waitUntil(transcribeRecording(c.env, { orgId, recordingId: id, r2Key: key }))
   return c.body(null, 204)
   ```

   Tests in `test/voice-route.test.ts` (await the promise directly rather than relying on
   `executionCtx` in the fake env — call `transcribeRecording` in the test and assert on it):
   a successful run ⇒ `transcript_status = 'done'`, `transcript_r2_key` ends `.transcript.json`,
   and the transcript object exists in the fake R2 store; a `transcribeAudio` that throws ⇒
   `transcript_status = 'failed'` **and the `cc_recordings` row and its `r2_key` survive intact**;
   a missing R2 object ⇒ `'failed'`, no throw.
   **Verify:** `npx vitest run` passes; gate 0.

### Arc C — Reporting

8. **Settings API.**
   Create `server/routes/settings.ts`, gated with `requireClarionRole('admin')` following
   `server/routes/queues.ts` exactly: `GET /api/settings` returns `getOrgSettings`;
   `PATCH /api/settings` validates `{ recordingEnabled?: boolean; announcementText?: string | null }`
   (reject non-boolean `recordingEnabled` with `bad_input` 400) and calls `upsertOrgSettings`.
   Write an `insertAuditLog` entry on PATCH — reuse the existing accessor in
   `server/db/audit.ts`; enabling recording is exactly the kind of change §6's audit log exists
   for. Mount in `server/app.ts` **inside** the gate: `app.route('/settings', settings)`.
   Tests `test/settings-route.test.ts`: agent ⇒ 403 on both verbs; supervisor ⇒ 403 on PATCH;
   admin ⇒ 200; PATCH round-trips; an audit row is written.
   **Verify:** `npx vitest run test/settings-route.test.ts` passes; gate 0.

9. **Reports API — filters and aggregates.**
   Add to `server/db/calls.ts` (no raw SQL in handlers — CLAUDE.md §10):

   ```ts
   export type CallFilter = { from?: string; to?: string; queueId?: string; agentId?: string; disposition?: string }
   export type CallSummary = { total: number; answered: number; abandoned: number; avgDurationS: number }

   /** Builds a WHERE from bound values only — column names are never interpolated. */
   function whereFor(orgId: string, f: CallFilter): { sql: string; binds: (string | number)[] } {
     const clauses = ['organization_id = ?']
     const binds: (string | number)[] = [orgId]
     if (f.from) { clauses.push('started_at >= ?'); binds.push(f.from) }
     if (f.to) { clauses.push('started_at <= ?'); binds.push(f.to) }
     if (f.queueId) { clauses.push('queue_id = ?'); binds.push(f.queueId) }
     if (f.agentId) { clauses.push('agent_id = ?'); binds.push(f.agentId) }
     if (f.disposition) { clauses.push('disposition = ?'); binds.push(f.disposition) }
     return { sql: clauses.join(' AND '), binds }
   }

   export async function queryCalls(db: D1Database, orgId: string, f: CallFilter): Promise<Call[]> {
     const { sql, binds } = whereFor(orgId, f)
     const { results } = await db
       .prepare(`SELECT ${COLS} FROM cc_calls WHERE ${sql} ORDER BY started_at DESC LIMIT 500`)
       .bind(...binds)
       .all<CallRow>()
     return results.map(toCall)
   }

   export async function summarizeCalls(db: D1Database, orgId: string, f: CallFilter): Promise<CallSummary> {
     const { sql, binds } = whereFor(orgId, f)
     const row = await db
       .prepare(`SELECT COUNT(*) AS total,
                        SUM(CASE WHEN agent_id IS NOT NULL THEN 1 ELSE 0 END) AS answered,
                        SUM(CASE WHEN agent_id IS NULL THEN 1 ELSE 0 END) AS abandoned,
                        COALESCE(AVG(duration_s), 0) AS avg_duration_s
                 FROM cc_calls WHERE ${sql}`)
       .bind(...binds)
       .first<{ total: number; answered: number; abandoned: number; avg_duration_s: number }>()
     return {
       total: row?.total ?? 0, answered: row?.answered ?? 0, abandoned: row?.abandoned ?? 0,
       avgDurationS: Math.round(row?.avg_duration_s ?? 0),
     }
   }
   ```

   Create `server/routes/reports.ts`: `GET /api/reports/calls`, `requireClarionRole('supervisor')`,
   reading the five filters from the query string and returning
   `{ success: true, data: { calls, summary } }`. Mount inside the gate.
   Tests `test/reports-route.test.ts`: agent ⇒ 403; supervisor ⇒ 200; each filter narrows the
   result set; the summary arithmetic is correct; **a cross-tenant test** — org B's request
   never returns org A's calls even when passing org A's `queueId`.
   **Verify:** `npx vitest run test/reports-route.test.ts` passes; gate 0.

10. **Recording media + transcript endpoints.**
    Create `server/routes/recordings.ts`, `requireClarionRole('supervisor')` on both — recorded
    audio is the most sensitive data Clarion holds, and an agent has no business reading the
    org's call history:

    ```ts
    recordings.get('/:id/media', requireClarionRole('supervisor'), async (c) => {
      const orgId = c.get('organizationId')
      if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
      const rec = await getRecordingById(c.env.DB, orgId, c.req.param('id'))
      if (!rec) return err(c, 'not_found', 'Recording not found', 404)   // cross-org => 404, never 403
      const obj = await c.env.RECORDINGS.get(rec.r2Key)
      if (!obj) return err(c, 'not_found', 'Recording media not found', 404)
      return new Response(obj.body, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'private, no-store' } })
    })
    ```

    `GET /:id/transcript` follows the same shape: 404 when `transcript_r2_key` is null, otherwise
    the JSON from R2 with `cache-control: private, no-store`. Mount inside the gate.
    A cross-org read returns **404, not 403** — deliberate: 403 would confirm the id exists.
    Tests `test/recordings-route.test.ts`: agent ⇒ 403; supervisor ⇒ 200 with `audio/mpeg`;
    org B fetching org A's recording id ⇒ **404**; transcript still pending ⇒ 404.
    **Verify:** `npx vitest run test/recordings-route.test.ts` passes; gate 0.

11. **Settings page.**
    Create `src/pages/Settings.tsx` against Step 8's API, admin-only, on vendored primitives
    (`Card`, `CardHead`, `Button`, `Badge`, `ErrorState`) — no bespoke styling. A toggle for
    recording and a text field for the announcement.
    **The toggle's copy must state that enabling recording also enables the caller
    announcement**, because §1 makes that a property of the system rather than a second choice
    the user is making. A user must not be able to read this screen and believe silent
    recording is available. Add `Settings` to the `AppShell` nav, rendered only for `admin`.
    **Verify:** gate 0; Playwright signs in via `DEV_AUTH` as an admin, loads `/settings`,
    toggles recording on, reloads, asserts it persisted, asserts the announcement copy is
    present, and screenshots to `docs/runs/2026-07-16-phase-4-recording/step-11-settings.png`.

12. **Reports page.**
    Create `src/pages/Reports.tsx` against Steps 9 and 10: `Stat` tiles for the four summary
    figures, a filterable table of calls (`.tabular` for SIDs and durations), an `<audio>`
    player sourced from `/api/recordings/:id/media`, and a transcript panel.
    The transcript panel keys off `transcript_status`: `pending` renders a `Spinner`, `failed`
    renders an `ErrorState`, `done` renders the text. **Do not render an empty box for a failed
    transcript** — a silent blank is how "the transcript is missing" becomes invisible.
    Use `@tanstack/react-query` and the vendored primitives throughout. Add `Reports` to the
    `AppShell` nav for `supervisor` and `admin`.
    **Verify:** gate 0; Playwright signs in as a supervisor, seeds a call + recording through
    the API, loads `/reports`, asserts the Stat tiles show the seeded figures, asserts an
    `<audio>` element with the right `src`, asserts the transcript renders, and screenshots to
    `docs/runs/2026-07-16-phase-4-recording/step-12-reports.png`.

13. **Documentation debt.**
    - `docs/design/foundry-clarion-design.md` §4: add `organization_id` to the `cc_recordings`
      row and add `transcript_status`; add a `cc_org_settings` row. §9: mark Phase 4's gate
      **cleared** with the decision and the date.
    - `CLAUDE.md` §6: same two table rows, so the schema table matches reality.
    - `CLAUDE.md` §9: add `AI_DRY_RUN` to the env block with the "no local simulator, bills the
      account" note.
    - `CLAUDE.md` §11: flip the recording-consent open question to `[x]` with the decision
      (off by default, announcement forced, wording per-org, 2026-07-16).
    - `CLAUDE.md` §7: note that Phase 4 records via the REST API on the in-progress leg and
      that **Phase 5 should move to conference recording** once reservations land — so a future
      session knows it was a considered choice against a Phase 5 dependency, not an oversight.
    **Verify:** `git grep -n "AI_DRY_RUN" CLAUDE.md` → hits in §9;
    `git grep -n "transcript_status" docs/design/foundry-clarion-design.md CLAUDE.md` → hits in
    both; `git grep -n "Recording consent / prompts" CLAUDE.md` → shows `[x]`; gate 0.

14. **Capstone + close the run.**
    Run the gate one final time and paste the output into `PROGRESS.md`. Confirm the rails held:
    `git grep -n "TWILIO_DRY_RUN" wrangler.jsonc` → `"true"`;
    `git grep -n '"AI_DRY_RUN"' wrangler.jsonc` → `"true"`;
    `git grep -n "DEV_AUTH" wrangler.jsonc` → **no output**.
    Then end the run per CLAUDE.md: archive `PLAN.md` + `PROGRESS.md` to
    `docs/runs/2026-07-16-phase-4-recording/`, write `DONE` as a real handoff note (what landed,
    what is blocked, where the archive went, recommended next run), commit and push both
    together.
    **Verify:** gate 0; `docs/runs/2026-07-16-phase-4-recording/` contains `PLAN.md`,
    `PROGRESS.md`, and the step screenshots; `DONE` exists and is non-empty; working tree clean.

---

## Explicitly NOT in this run

- **Any live Twilio account mutation.** `TWILIO_DRY_RUN` stays `"true"`.
- **Any live Workers AI call.** `AI_DRY_RUN` stays `"true"`. It bills real money and has no
  local simulator. Steven must be in-session to flip it.
- **Creating the R2 bucket in the cloud.** Miniflare provides it locally. No
  `wrangler r2 bucket create`. No `wrangler deploy`. No Cloudflare account change.
- **`cc_numbers` / dialed-number lookup.** Voice webhooks keep using `?orgId=&queueId=`. Known
  debt, deliberately deferred — it touches Phase 3's webhook contract and needs its own run.
- **Conference-based recording.** Needs reservation acceptance, which is Phase 5.
- **Retention policies, PII redaction, transcript search.** YAGNI until asked.
- **A second announcement toggle**, however reasonable it looks. See the consent decision.
- Supervisor monitor/whisper/barge, outbound click-to-call (Phase 5).
- Fixing `@cloudflare/vitest-pool-workers` on Windows. Not this run's problem.
- Editing `skills-foundry` or `authpak` in any way, including "just a small fix".
- Pushing `main`, or merging this branch. Steven owns both.
