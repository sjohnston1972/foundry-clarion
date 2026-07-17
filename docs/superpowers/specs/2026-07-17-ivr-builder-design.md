# IVR builder — design

**Date:** 2026-07-17
**Branch:** `feat/ivr-builder`
**Status:** approved (Steven), pending spec review

## Problem

Clarion has no IVR. Inbound calls today go straight from `POST /api/voice/inbound?orgId=&queueId=`
to `<Enqueue workflowSid>`. We want admins to **build call flows visually** (a ReactFlow
canvas) — "press 1 for Sales", after-hours branches, collect an account number, take a
voicemail — and have those flows actually execute.

## Decisions locked (do not relitigate)

- **Engine = Clarion-native TwiML interpreter, NOT Twilio Studio** (2026-07-17, Steven).
  ReactFlow only produces the flow JSON; our Worker walks the graph and emits TwiML.
  Rationale: less integration surface, testable in-Worker under the dry-run rails, fits
  "custom UI on raw Twilio, not Flex" (CLAUDE.md §2). **This supersedes CLAUDE.md §7's
  Studio assumption — update §7 as part of this work.**
- **v1 node set (rich core):** Start, Play/Say, Menu (1-key DTMF), Collect-digits (→ variable),
  If/branch, Business-hours, Route-to-queue, Voicemail, Hangup.
- **v1 executes** via the live interpreter, testable under dry-run. **Attaching a flow to a
  real inbound number is Phase 5** (needs a `cc_numbers` table + live Twilio).
- **Flow state (collected variables) rides in the action URL** as base64-JSON — no server
  session. D1/DO-per-CallSid is the documented scale path, not built in v1.
- **Lifecycle:** flows have a `status` ('draft'/'active'); saving overwrites in place. No
  versioning in v1.
- **Hold / Retrieve-from-hold / Answer are NOT IVR nodes** — they are agent call-control
  actions (Phase 5), or (music-on-hold-while-queued) a property of the Route-to-queue node's
  `waitUrl`, not a node. **Goto/Label are not nodes** — a graph edge back to an earlier node
  is a goto; loops are edges.

## Data model

Two new tables in Clarion's D1 (migration `0005_ivr.sql`), both org-scoped by column.

**`cc_ivr_flows`**
| col | type | notes |
|---|---|---|
| id | TEXT PK | uuid |
| organization_id | TEXT NOT NULL | tenant scope |
| name | TEXT NOT NULL | |
| status | TEXT NOT NULL DEFAULT 'draft' | 'draft' \| 'active' |
| definition_json | TEXT NOT NULL | the flow graph (schema below) |
| updated_at | INTEGER NOT NULL | epoch ms (passed in; no `Date.now()` in D1) |

Index: `(organization_id)`.

**`cc_voicemails`** — voicemail audio is semantically distinct from an agent-call recording,
so it is its own table (reusing the R2 + Whisper pipeline from Phase 4).
| col | type | notes |
|---|---|---|
| id | TEXT PK | uuid |
| organization_id | TEXT NOT NULL | tenant scope |
| flow_id | TEXT | REFERENCES cc_ivr_flows(id) ON DELETE SET NULL |
| twilio_call_sid | TEXT NOT NULL | |
| from_e164 | TEXT | |
| r2_key | TEXT NOT NULL | `orgs/{org}/voicemails/{callSid}/{recSid}.mp3` |
| duration_s | INTEGER | |
| transcript_r2_key | TEXT | |
| transcript_status | TEXT DEFAULT 'pending' | reuse Phase 4 seam |
| created_at | INTEGER NOT NULL | epoch ms |

Typed accessors in `server/db/ivr-flows.ts` and `server/db/voicemails.ts` (no raw SQL in handlers).

### Flow JSON schema (`definition_json`)

```jsonc
{
  "entryNodeId": "n_start",
  "nodes": [
    { "id": "n_start", "type": "start",    "position": {"x":0,"y":0}, "config": {} },
    { "id": "n_hi",    "type": "play",      "position": {...}, "config": { "say": "Thanks for calling Acme." } },
    { "id": "n_menu",  "type": "menu",      "position": {...}, "config": { "prompt": "Press 1 for Sales, 2 for Support.", "timeoutSeconds": 5 } },
    { "id": "n_acct",  "type": "collect",   "position": {...}, "config": { "prompt": "Enter your account number.", "numDigits": 6, "variable": "acct" } },
    { "id": "n_if",    "type": "if",        "position": {...}, "config": { "left": "$acct", "op": "eq", "right": "0" } },
    { "id": "n_hours", "type": "businessHours","position":{...},"config": { "timezone": "Europe/London", "weekly": [{"day":1,"open":"09:00","close":"17:00"}, ...] } },
    { "id": "n_sales", "type": "routeToQueue","position":{...},"config": { "queueId": "q_123" } },
    { "id": "n_vm",    "type": "voicemail", "position": {...}, "config": { "prompt": "Leave a message.", "maxLengthSeconds": 120 } },
    { "id": "n_bye",   "type": "hangup",    "position": {...}, "config": {} }
  ],
  "edges": [
    { "source": "n_menu", "target": "n_sales", "branch": "1" },
    { "source": "n_menu", "target": "n_support", "branch": "2" },
    { "source": "n_menu", "target": "n_bye", "branch": "timeout" },
    { "source": "n_menu", "target": "n_hi",  "branch": "invalid" },
    { "source": "n_if",   "target": "...", "branch": "true" },
    { "source": "n_if",   "target": "...", "branch": "false" },
    { "source": "n_hours","target": "...", "branch": "open" },
    { "source": "n_hours","target": "...", "branch": "closed" },
    { "source": "n_hi",   "target": "n_menu", "branch": "next" }
  ]
}
```

`branch` is the edge label. Linear nodes (start, play, collect→, routeToQueue, voicemail→,
hangup) use `"next"`; branching nodes (menu per-key + `timeout`/`invalid`, if `true`/`false`,
businessHours `open`/`closed`) use named branches.

## The interpreter

One signature-validated webhook handles entry **and** every continuation:

`POST /api/voice/ivr?orgId=<org>&flowId=<flow>[&node=<id>][&vars=<b64>]`

- Same Twilio-signature validation as the existing voice webhooks (`isValidTwilioSignature`),
  mounted alongside `voice` outside the AuthPak gate.
- `node` absent ⇒ start at `entryNodeId`. `vars` is base64-JSON of accumulated variables
  ({} at entry).
- **Walk-until-you-must-wait:** the interpreter resolves nodes server-side, chaining TwiML,
  until it reaches a node that must wait for the caller or terminates:
  - `start` → follow `next`.
  - `play` → append `<Say>`/`<Play>`, follow `next`.
  - `if` → evaluate `config` against `vars` (safe evaluator, no `eval`), follow `true`/`false`.
  - `businessHours` → evaluate now-in-schedule for the node's timezone, follow `open`/`closed`.
  - `menu` → emit accumulated `<Say>` + `<Gather numDigits=1 action=".../ivr?...&node=<self>&vars=<b64>" timeout=…>`; **STOP** (Twilio POSTs the digit back to this endpoint with `Digits`; we match it to an edge `branch`, fall to `invalid`/`timeout` edges otherwise).
  - `collect` → emit `<Gather numDigits=N action=…>`; on callback, store `Digits` into `config.variable` within `vars`, follow `next`.
  - `routeToQueue` → resolve `config.queueId` → emit `<Enqueue workflowSid=…>` (reusing today's inbound behaviour incl. the recording-consent `<Say>` invariant); **TERMINAL**.
  - `voicemail` → emit `<Say>` + `<Record action=… maxLength=… recordingStatusCallback=/api/voice/voicemail?orgId=&flowId=&callSid=…>`; **TERMINAL** (callback stores to R2 + `cc_voicemails`, hands transcription to `waitUntil`, mirroring Phase 4).
  - `hangup` → emit `<Hangup>`; **TERMINAL**.
- **State:** each `<Gather>`/`<Record>` `action` URL carries the current `node` and the
  updated `vars` blob. Twilio round-trips it; signature validation covers the full URL.
- Loop/depth guard: a max-steps counter per request (e.g. 50) prevents an accidental cycle
  of linear nodes from looping forever; exceeding it emits `<Hangup>` and logs.

Interpreter lives in `server/lib/ivr/` (graph model + `interpret(flow, nodeId, vars, input)`
pure core, separately unit-testable) with the thin webhook in `server/routes/ivr-voice.ts`.

## CRUD + editor API

`server/routes/ivr.ts` (admin for writes, supervisor+ for read), all org-scoped, cross-org → 404:
- `GET /api/ivr/flows` — list.
- `GET /api/ivr/flows/:id` — one flow (with `definition_json` parsed).
- `POST /api/ivr/flows` — create (`{name}`; empty starter graph = one Start node).
- `PUT /api/ivr/flows/:id` — save `{name?, status?, definition}` — **server-side validation
  runs here** (below); invalid ⇒ 400 with the failing rule.
- `DELETE /api/ivr/flows/:id` — delete (+ `ivr.delete` audit).
- Voicemail read endpoints mirror the recordings pattern (list + media, supervisor+, cross-org 404).

### Validation rules (client on edit, server on save — shared module)

`server/lib/ivr/validate.ts` (imported by the route; mirrored in the client):
1. Exactly one `start` node; `entryNodeId` points to it.
2. Every non-terminal node has an outgoing edge for each required branch (menu: ≥1 key +
   `timeout` + `invalid`; if: `true`+`false`; hours: `open`+`closed`; linear: `next`).
3. No orphan nodes (every node except start is reachable from start).
4. Every path terminates (routeToQueue / voicemail / hangup) — no dead ends.
5. Menu keys are unique digits; `collect.variable` is a valid identifier; `routeToQueue.queueId`
   exists in the org.

## Editor (frontend)

`src/pages/IvrFlows.tsx` (list + create/delete) and `src/pages/IvrEditor.tsx` (the canvas).
Dependency: **`@xyflow/react`** (ReactFlow v12) — new dep, vendored via npm.
- Custom node components per type, styled to the Clarion design tokens (frontend-design skill
  at build time). A **palette** to drop nodes; edges drawn by dragging; a **config panel**
  (right rail) binds the selected node's `config`.
- Live client-side validation surfaces rule failures inline; Save calls `PUT` (server
  re-validates).
- **In-browser simulator:** a "Test" panel walks the flow graph purely client-side (no
  telephony) — pick a menu key, enter digits, toggle "after hours" — and highlights the path
  + shows the TwiML that would be emitted. This is how flows are exercised before Phase 5.
- Nav entry in `AppShell` (admin/supervisor).

## Testing (TDD)

- **Interpreter core** (`server/lib/ivr/interpret`): pure-function tests per node type —
  play chains, menu digit→branch + timeout/invalid, collect stores var, if true/false, hours
  open/closed (inject "now"), routeToQueue emits Enqueue, voicemail emits Record, hangup,
  max-steps guard. State round-trip: vars survive a Gather callback via the action URL.
- **Webhook** (`ivr-voice.ts`): signature required; entry vs continuation; cross-org/unknown
  flow → 404; the voicemail callback writes R2 + `cc_voicemails` + waitUntil transcription
  (mirror `voice-route.test.ts`).
- **Validation** module: each rule rejects its violation; a valid flow passes.
- **DB accessors:** org-scoped get/list/delete, cross-org isolation.
- **Rails:** no path hits `taskrouter.twilio.com`; AI stays behind `AI_DRY_RUN`.
- Frontend: build/typecheck (no unit-test harness); the simulator is the manual drive.

## Out of scope (Phase 5+)

- Attaching a flow to a real inbound number (`cc_numbers`, live Twilio, real signature flow).
- Hold / retrieve-from-hold / agent call-control.
- Business-hours holidays/exceptions; subflows; Set-variable arithmetic beyond simple compare.
- Flow versioning / publish history.
- Per-CallSid server-side state (only if URL-carried state proves insufficient).

## Docs

Update CLAUDE.md §7 (Studio → native interpreter) and §6 (new tables), and the design doc
`docs/design/foundry-clarion-design.md` §4/§9 as they did for Phase 4.
