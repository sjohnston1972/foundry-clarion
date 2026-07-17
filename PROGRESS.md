# Progress — IVR builder (v1) run

**Goal:** Ship a working, tested v1 IVR builder — a Clarion-native TwiML interpreter that
executes visual call flows (Start, Play/Say, Menu, Collect-digits, If, Business-hours,
Route-to-queue, Voicemail, Hangup) plus a ReactFlow editor with an in-browser simulator.
All decisions are locked in `docs/superpowers/specs/2026-07-17-ivr-builder-design.md`.
Dry-run rails stay on; attaching a flow to a real number is Phase 5 (out of scope).

Branch: `feat/ivr-builder`. See PLAN.md for the ordered steps and done-conditions.

## Log
<!-- Append one timestamped entry per completed step. -->

### 2026-07-17 — Step 1 done: migration 0005_ivr.sql

Added `cc_ivr_flows` (org-scoped, `status` draft/active, `definition_json`,
`updated_at` epoch-ms passed in) and `cc_voicemails` (org-scoped, `flow_id`
FK → `cc_ivr_flows(id) ON DELETE SET NULL`, reuses Phase 4's R2/Whisper
transcript-status shape). `test/ivr-migration.test.ts` passes (5 tests);
`npm run d1:migrate:local` applied cleanly (7 commands, all ✅).
Committed as cd3a57c and pushed to `feat/ivr-builder`.
Next: Step 2 — DB accessors (`server/db/ivr-flows.ts`, `server/db/voicemails.ts`).

### 2026-07-17 — Step 2 done: DB accessors

Added `server/db/ivr-flows.ts` (get/list/create/update/delete, org-scoped,
JSON parse/stringify of `definition_json`; independent `name`/`status`/
`definition` updates each bump `updated_at`) and `server/db/voicemails.ts`
(insert/list/get, org-scoped). `test/ivr-db.test.ts` (in-memory fake-D1,
mirrors `queues-db.test.ts`) covers both, including cross-org isolation on
get/list/update. Full suite green: 30 files, 117 tests. Committed as
96bd48b and pushed to `feat/ivr-builder`.
Next: Step 3 — graph model + validation (`server/lib/ivr/graph.ts`,
`server/lib/ivr/validate.ts`).

### 2026-07-17 — Step 3 done: graph model + validation

Added `server/lib/ivr/graph.ts` (discriminated-union `IvrNode` types for all
9 v1 node kinds, `IvrEdge`/`IvrFlowDefinition`, terminal/waiting type sets,
`emptyFlowDefinition()` starter graph) and `server/lib/ivr/validate.ts`
(`validateFlow(flow, {queueIds})` — the 5 spec rules: single start +
entryNodeId, required branches per node type incl. menu digit-key +
timeout/invalid, no orphans via forward BFS from start, every path reaches
a terminal node via backward BFS from terminals, menu key uniqueness +
collect identifier validity + routeToQueue queue existence). Returns
`{valid, errors[]}` (all violations collected, not just the first) so the
client can surface every failure inline in Step 12. `test/ivr-validate.test.ts`
covers a valid flow plus each rule's violation, including a two-node cycle
with no terminal exit for rule 4 (10 tests). Full suite green: 31 files,
127 tests. `npm run typecheck:server` clean. Committed as a233872 and
pushed to `feat/ivr-builder`.
Next: Step 4 — interpreter core (`server/lib/ivr/interpret.ts`).

### 2026-07-17 — Step 4 done: interpreter core

Added `server/lib/ivr/interpret.ts` — pure `interpret(flow, nodeId, vars, input)`,
no D1/Twilio I/O. Design note not fully pinned by the spec: everything the
walk needs from its environment (injected `now`, a `buildGatherActionUrl`
callback, `queueWorkflowSids` map, pre-built `enqueueTaskXml`, and
`recordingConsentSay`) arrives via the 4th `input` param, since a truly pure
function can't fetch a queue's workflow SID or build a URL containing
orgId/flowId itself — those will be supplied by the Step 5 webhook. A
`first`-node flag distinguishes "resuming the exact waiting node the
caller asked about" (consumes `input.digits`) from "freshly reaching a
menu/collect later in the same walk" (emits a new Gather and stops) —
this is what makes invalid/timeout re-prompts and multi-menu flows work
without ambiguity. businessHours uses `Intl.DateTimeFormat` per-timezone
(no eval, no external tz library); day convention documented as JS
`getDay()` (0=Sun..6=Sat) since the spec's single example didn't pin it.
`test/ivr-interpret.test.ts` (11 tests) covers every node type, menu
digit/timeout/invalid, collect-stores-var, the vars round-trip across two
calls, businessHours open/closed with injected `now`, and the MAX_STEPS=50
loop guard. Full suite green: 32 files, 138 tests. `npm run typecheck:server`
clean. Committed as 3d53891 and pushed to `feat/ivr-builder`.
Next: Step 5 — interpreter webhook (`server/routes/ivr-voice.ts`).

### 2026-07-17 — Step 5 done: interpreter webhook

Added `server/routes/ivr-voice.ts` — `POST /api/voice/ivr?orgId=&flowId=[&node=&vars=]`,
mounted alongside `voice` in `server/app.ts` (outside the AuthPak gate, same
X-Twilio-Signature validation). It's the thin I/O shell around Step 4's
pure `interpret()`: resolves the flow (cross-org/unknown -> 404, never
403), decodes the base64 `vars` blob, fetches `routeToQueue` workflow SIDs
and org recording-consent settings, builds the Gather action URL fresh
per node/vars (so state round-trips through the query string with no
server-side session, per the spec), and wraps the result in `<Response>`.
`test/ivr-voice.test.ts` (8 tests, mirrors `voice-route.test.ts`) drives
this through real HTTP requests via `createApp().request()`: signature
required, entry walks to the first Gather, a mapped digit reaches
`<Enqueue>`, a Gather timeout follows "timeout" to Hangup, an unmapped
digit follows "invalid" and re-prompts, unknown flow and cross-org flow
both -> 404. Digit-callback tests parse the actual `action=` URL out of
the entry response rather than hand-constructing it, so the test also
exercises the URL-building code path. Full suite green: 33 files, 146
tests. `npm run typecheck:server` clean. Committed as dcffa1c and pushed
to `feat/ivr-builder`.
Next: Step 6 — voicemail callback (`POST /api/voice/voicemail`).

### 2026-07-17 — Step 6 done: voicemail callback

Added `POST /api/voice/voicemail?orgId=&flowId=&callSid=` to
`server/routes/ivr-voice.ts` — the voicemail node's Record action/
recordingStatusCallback, signature-validated, non-'completed' status is
a 204 no-op (mirrors the Phase 4 `/recording` handler shape). Writes
audio to R2 at `orgs/{org}/voicemails/{callSid}/{recSid}.mp3`, inserts a
`cc_voicemails` row, hands transcription to `waitUntil`. Added
`setVoicemailTranscript` (`server/db/voicemails.ts`) and
`transcribeVoicemail` (`server/lib/ai/transcribe.ts`, reuses
`transcribeAudio`'s dry-run-gated Whisper call but writes to
`cc_voicemails` instead of `cc_recordings`) to close the loop. Design
call: `flow_id` is best-effort (nullable, `ON DELETE SET NULL`) — an
unknown/cross-org `flowId` stores the voicemail anyway with `flow_id`
null rather than failing the whole callback, since the audio capture
matters more than the flow attribution. `test/ivr-voice.test.ts` gained
4 cases (12 total in the file): signature required, non-completed
no-op, a completed callback writing R2 + row + handing off transcription
(verified by awaiting the handed-off promise, same pattern as
`voice-route.test.ts`), and an unknown flowId still storing the
voicemail. Full suite green: 33 files, 150 tests. `npm run
typecheck:server` clean. Committed as 4cbe543 and pushed to
`feat/ivr-builder`.
Next: Step 7 — flow CRUD API (`server/routes/ivr.ts`).

### 2026-07-17 — Step 7 done: flow CRUD API

Added `server/routes/ivr.ts`, mounted at `/api/ivr` in `server/app.ts`:
list/get (supervisor+), create/put/delete (admin), org-scoped, cross-org
-> 404 throughout. POST creates an empty starter graph (one Start node)
unvalidated by design — it has no terminal path yet, and the spec scopes
validation to PUT. Design call beyond the spec's literal text: PUT
re-validates whenever a new `definition` is supplied, AND whenever the
resulting `status` would be `'active'` even with no `definition` in the
body (re-validating the flow's existing stored definition in that case)
— closes a gap where `PUT {status:'active'}` alone could otherwise flip
an already-invalid flow live without ever running validate.ts. Invalid
-> 400 with the failing rule(s) joined into the message. DELETE writes
an `ivr.delete` audit entry via the existing `cc_audit_log` table.
`test/ivr-route.test.ts` (12 tests, mirrors `queues-route.test.ts` /
`recordings-route.test.ts`) covers role gates, starter-graph create,
empty-name rejection, cross-org 404 on get/put/delete, valid/invalid
definition saves, the active-revalidates-existing-definition case, and
the delete audit entry. Full suite green: 34 files, 162 tests. `npm run
typecheck:server` clean. Committed as 9585e01 and pushed to
`feat/ivr-builder`.
Next: Step 8 — voicemail read API (list + media endpoints).

### 2026-07-17 — Step 8 done: voicemail read API

Added `GET /api/ivr/voicemails` (list, supervisor+) and
`GET /api/ivr/voicemails/:id/media` (stream audio from R2, supervisor+)
to `server/routes/ivr.ts`, mirroring `recordings.ts`'s pattern exactly:
cross-org id -> 404 never 403, missing R2 object -> 404 even with a
valid row, `private, no-store` cache-control. Deliberately did not add a
transcript endpoint — the plan's Step 8 scope says "list + media
endpoints" only, so that wasn't built here (recordings has one; a
follow-up run can add the voicemail equivalent if wanted).
`test/ivr-route.test.ts` gained 5 cases (17 total): role gates, a
supervisor listing and streaming media, cross-org 404, a list scoped to
the caller's own org, and a missing-R2-object 404. Full suite green: 34
files, 167 tests. `npm run typecheck:server` clean. Committed as
8e8416f and pushed to `feat/ivr-builder`.
Next: Step 9 — backend gate (full suite + typecheck + lint).

### 2026-07-17 — Step 9 done: backend gate

Verification-only step, no code changes. Ran the full gate: `npx vitest
run` (34 files, 167 tests, all green), `npm run typecheck:server` (clean),
`npm run lint` (oxlint, clean, zero warnings). Backend arc (Steps 1-9) is
complete — migration, DB accessors, graph model + validation, the pure
interpreter core, the interpreter and voicemail webhooks, the flow CRUD
API, and the voicemail read API all in place and tested. No commit for
this step (nothing changed in the working tree).
Next: Step 10 — ReactFlow dep + flow list page (`src/pages/IvrFlows.tsx`).
Frontend arc begins here; steps 10-13 are verified by `npm run build`
(typecheck) rather than vitest, per the plan's notes.
