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
