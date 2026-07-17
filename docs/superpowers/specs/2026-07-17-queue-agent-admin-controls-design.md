# Queue & agent admin controls — design

**Date:** 2026-07-17
**Branch:** `feat/queue-agent-admin-controls`
**Status:** approved (Steven), pending spec review

## Problem

Three admin-management gaps surfaced in use:

1. **No way to delete a queue** from the UI.
2. **No way to choose a queue's call-distribution algorithm** — `strategy` is a
   free-form string, hardcoded to `longest-idle` on create, with no picker.
3. **No way to remove the agent role from a user** — `enable` exists, its inverse
   does not.

All three sit inside the existing dry-run rails: `TWILIO_DRY_RUN` and `AI_DRY_RUN`
stay `"true"`. No Twilio account state is touched. Real TaskRouter Worker/Workflow
teardown and real routing behaviour are deferred to Phase 5 (live telephony); this
work is the data-model + API + UI layer that Phase 5 will wire to Twilio.

## Decisions locked

- **Agent removal = "disable as agent"** — the exact inverse of *Enable as agent*:
  remove the `cc_agents` row. Clarion membership/role in `cc_members` is untouched.
  (Not a `cc_members.clarion_role` edit.)
- **Distribution strategies offered:** `longest-idle`, `round-robin`, `ring-all`,
  `priority`. These are the full enum; `strategy` becomes validated, not free-form.
- **Strategy edits save immediately** on change (no separate Save button).
- **Disabling an agent is allowed even if status is `on-call`** — no live calls exist
  under dry-run; a mid-call guard is a Phase 5 concern.
- **Cross-org access returns 404, never 403** (mirrors the recordings endpoints).

## Design

### A. Distribution strategies — make `strategy` a real enum

- New `server/lib/queues/strategies.ts`:
  - `QUEUE_STRATEGIES = ['longest-idle', 'round-robin', 'ring-all', 'priority'] as const`
  - `type QueueStrategy = typeof QUEUE_STRATEGIES[number]`
  - `isQueueStrategy(x: unknown): x is QueueStrategy`
  - `QUEUE_STRATEGY_LABELS: Record<QueueStrategy, string>` (e.g. `'longest-idle' → 'Longest idle'`)
- `POST /api/queues`: when `strategy` is present it must pass `isQueueStrategy`, else
  `400 bad_input`. Omitted ⇒ defaults to `longest-idle` (unchanged default).
- `PATCH /api/queues/:id`: when `strategy` is present it must pass `isQueueStrategy`,
  else `400 bad_input`. (Today it accepts any string.)
- Frontend mirrors `QUEUE_STRATEGY_LABELS` in `src/lib/strategies.ts` (small, server
  stays source of truth for validation).
- **Storing the value is the whole job now.** It feeds real TaskRouter routing when
  telephony goes live; nothing routes under dry-run. `createWorkflow` still receives
  `configuration: {}` — translating strategy → Workflow config is Phase 5.

### B. Delete queue — UI (backend already exists)

- `DELETE /api/queues/:id` already exists and is admin-gated. FK behaviour is already
  correct: `cc_queue_members.queue_id … ON DELETE CASCADE` (members auto-unassigned)
  and `cc_calls.queue_id … ON DELETE SET NULL` (call history preserved, unlinked).
- **Add audit:** the delete route currently writes no audit row. Add
  `insertAuditLog(action: 'queue.delete', meta: { queueId, name })` for traceability,
  matching the `agent.enable` precedent.
- **UI:** a destructive "Delete" control on each queue row using an inline two-step
  confirm (click *Delete* → row shows *Delete "Support"? Agents are unassigned; call
  history is kept.* with *Confirm* / *Cancel*). On success invalidate `['queues']`.

### C. Strategy control — UI

- **Create form:** add a strategy `<select>` (options from `QUEUE_STRATEGY_LABELS`,
  default `longest-idle`); the create mutation sends the chosen `strategy`.
- **Existing queue:** replace the static strategy `<Badge>` with an inline `<select>`
  that fires a `PATCH /api/queues/:id { strategy }` on change (admin), with a brief
  saved/pending state. On success invalidate `['queues']`.

### D. Disable agent — new backend + UI

- **New `DELETE /api/agents/:id`** (admin):
  1. Input: `id` path param.
  2. Auth: `requireClarionRole('admin')`.
  3. Lookup `getAgentById(DB, orgId, id)` scoped to org; not found ⇒ `404 not_found`
     (cross-org lands here too — 404, never 403).
  4. Delete the `cc_agents` row; `cc_agent_skills.agent_id … ON DELETE CASCADE`
     removes snapshots. `cc_calls.agent_id … ON DELETE SET NULL` keeps history.
  5. `insertAuditLog(action: 'agent.disable', meta: { agentId, email })`.
  6. `pushPresence(env, orgId, { identity: email, status: 'offline', at })` so the
     wallboard drops them from realtime.
  7. Twilio Worker teardown is a **Phase 5 TODO** (commented; dry-run today).
  8. Response: `{ success: true, data: { id } }`.
- New accessor `getAgentById(db, orgId, id)` and `deleteAgent(db, orgId, id)` in
  `server/db/agents.ts` (org-scoped, no raw SQL in the handler).
- **UI (`src/pages/Agents.tsx`):** a "Disable" control per enabled-agent row with the
  same inline two-step confirm. On success invalidate `['agents']` **and**
  `['agents','candidates']` so the person reappears as an enable candidate.

### E. Audit consistency

New audit actions: `queue.delete`, `queue.strategy` (on strategy change via PATCH),
`agent.disable`. Existing `agent.enable` is the precedent.

## Testing (TDD — tests first)

Server (Vitest):
- Strategy validation: `POST` and `PATCH` with an unknown `strategy` ⇒ 400; each of
  the four valid values ⇒ accepted and persisted.
- `PATCH` strategy change writes a `queue.strategy` audit row.
- Queue delete: row gone, member rows cascade-deleted, a linked `cc_calls` row has
  `queue_id` nulled (history kept), audit row written, cross-org delete ⇒ 404.
- Disable agent: `cc_agents` row gone, `cc_agent_skills` cascade-deleted, audit row
  written, a presence push fired, cross-org ⇒ 404. Re-enable path still works after.

Frontend: follow existing page test patterns; at minimum the mutations call the right
endpoints and invalidate the right query keys.

Rails assertion: no code path calls a real Twilio mutation; provisioning stays behind
`TWILIO_DRY_RUN`.

## Out of scope (Phase 5)

- Translating `strategy` into real TaskRouter Workflow configuration.
- Deleting the TaskRouter Workflow when a queue is deleted.
- Deleting the TaskRouter Worker when an agent is disabled.
- Guarding disable/delete against in-flight calls.
