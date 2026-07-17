# Run plan — IVR builder (v1)

**Branch:** `feat/ivr-builder` (already checked out; commit + push each step to it — do NOT create new branches).
**Spec (source of truth for all detail — read it first every turn):**
`docs/superpowers/specs/2026-07-17-ivr-builder-design.md`
**Also read:** project `CLAUDE.md` (conventions, tenancy, dry-run rails) and global run discipline.

## Goal

Ship a working, tested v1 IVR builder: a Clarion-native TwiML interpreter that executes
visual call flows, plus a ReactFlow editor to build them. All decisions are locked in the
spec — no step below requires a decision from Steven. Everything stays behind the dry-run
rails; attaching a flow to a real inbound number is explicitly Phase 5 (out of scope).

## Standing rails (must hold all run — same as Phase 4)

- `TWILIO_DRY_RUN` and `AI_DRY_RUN` stay `"true"` in `wrangler.jsonc`. No Twilio account
  mutation; no Workers AI spend. Do not flip either.
- No path may call `taskrouter.twilio.com` or any live Twilio mutation. Voicemail transcription
  goes through the existing `AI_DRY_RUN`-gated Whisper seam.
- Every table/row is org-scoped (`organization_id`); cross-org access returns **404, never 403**.
- TDD: write the failing test first, make it pass, then commit. Full suite green before each commit.
- One step per turn; `git commit` + `git push` each step; append a timestamped PROGRESS.md entry.

## Steps

Each step's done-condition is a command whose success closes the step.

- [ ] **Step 1 — Migration `0005_ivr.sql`.** Create `cc_ivr_flows` + `cc_voicemails` per spec
  §"Data model" (org-scoped; FKs as specified). Add `test/ivr-migration.test.ts`.
  **Done:** `npx vitest run test/ivr-migration.test.ts` passes AND
  `npm run d1:migrate:local` applies cleanly.

- [ ] **Step 2 — DB accessors.** `server/db/ivr-flows.ts` (get/list/create/update/delete,
  org-scoped, JSON parse/stringify of `definition_json`) and `server/db/voicemails.ts`
  (insert/list/get, org-scoped). Tests `test/ivr-db.test.ts` (in-memory fake-D1 pattern;
  include cross-org isolation). **Done:** `npx vitest run test/ivr-db.test.ts` passes.

- [ ] **Step 3 — Graph model + validation.** `server/lib/ivr/graph.ts` (node/edge/flow types)
  and `server/lib/ivr/validate.ts` (the 5 rules in spec §Validation). Tests
  `test/ivr-validate.test.ts` — each rule rejects its violation; a valid flow passes.
  **Done:** `npx vitest run test/ivr-validate.test.ts` passes.

- [ ] **Step 4 — Interpreter core.** `server/lib/ivr/interpret.ts` — pure
  `interpret(flow, nodeId, vars, input)` that walks-until-it-must-wait and returns
  `{ twiml, terminal }` plus next-node/vars, per spec §"The interpreter". Cover every node
  type, the digit→branch + timeout/invalid logic, collect-stores-var, if/hours branching
  (inject "now"), the vars round-trip, and the max-steps guard. Tests `test/ivr-interpret.test.ts`.
  **Done:** `npx vitest run test/ivr-interpret.test.ts` passes.

- [ ] **Step 5 — Interpreter webhook.** `server/routes/ivr-voice.ts` — `POST /api/voice/ivr`
  (entry + continuation), Twilio-signature validated, mounted outside the AuthPak gate next to
  `voice`; cross-org/unknown flow → 404. Tests `test/ivr-voice.test.ts` (mirror
  `voice-route.test.ts`: signature required, entry vs continuation, digit callback advances).
  **Done:** `npx vitest run test/ivr-voice.test.ts` passes.

- [ ] **Step 6 — Voicemail callback.** `POST /api/voice/voicemail` — store audio to R2 +
  `cc_voicemails` row + `waitUntil` transcription (reuse Phase 4 recording pipeline). Extend
  the webhook tests. **Done:** `npx vitest run test/ivr-voice.test.ts` passes (voicemail case
  writes R2 + row + hands off transcription).

- [ ] **Step 7 — Flow CRUD API.** `server/routes/ivr.ts` — list/get (supervisor+),
  create/put(with server-side validate)/delete (admin, `ivr.*` audit), org-scoped, cross-org
  404. Mount in `server/app.ts`. Tests `test/ivr-route.test.ts`. **Done:**
  `npx vitest run test/ivr-route.test.ts` passes.

- [ ] **Step 8 — Voicemail read API.** List + media endpoints (supervisor+, cross-org 404),
  mirroring the recordings endpoints. Tests. **Done:** `npx vitest run test/ivr-route.test.ts`
  passes (voicemail read cases).

- [ ] **Step 9 — Backend gate.** Run full suite + server typecheck + lint. **Done:**
  `npx vitest run && npm run typecheck:server && npm run lint` all green. (Backend arc complete.)

- [ ] **Step 10 — ReactFlow dep + flow list page.** `npm i @xyflow/react`; `src/pages/IvrFlows.tsx`
  (list/create/delete) + nav entry in `AppShell` (admin/supervisor) + route in `App.tsx`.
  **Done:** `npm run build` passes.

- [ ] **Step 11 — Editor canvas.** `src/pages/IvrEditor.tsx` — ReactFlow canvas, node palette,
  a custom node component per type styled to Clarion design tokens, edge drawing, and a right-rail
  config panel bound to the selected node's `config`. Save → `PUT`. **Done:** `npm run build` passes.

- [ ] **Step 12 — Client validation.** Share the rule set (mirror `server/lib/ivr/validate.ts`)
  and surface failures inline in the editor; block Save on invalid. **Done:** `npm run build` passes.

- [ ] **Step 13 — In-browser simulator.** A "Test" panel that walks the flow client-side (no
  telephony): pick a menu key, enter digits, toggle after-hours; highlight the path + show the
  TwiML that would be emitted. **Done:** `npm run build` passes.

- [ ] **Step 14 — Docs + final gate + close.** Update `CLAUDE.md` §7 (Studio → native
  interpreter, cite the decision) and §6 (new tables), and `docs/design/foundry-clarion-design.md`
  §4/§9. Run the full gate. **Done:** `npx vitest run && npm run typecheck:server && npm run lint
  && npm run build` all green. Then follow the run-ending discipline (archive PLAN/PROGRESS,
  write DONE).

## Notes / known limits for the run

- **"Beautiful" is bounded here.** The editor will be functional, validated, and design-token
  styled, but true visual polish of the canvas is best iterated interactively with Steven —
  the simulator + a clean layout are the bar for this run; note polish ideas in DONE rather
  than gold-plating.
- If any step is genuinely ambiguous despite the spec, STOP: write the question under a
  "Blockers" heading in PROGRESS.md and end the run. Do not guess overnight.
- Frontend has no unit-test harness; steps 10-13 are verified by `npm run build` (typecheck)
  + the simulator as the manual drive.
