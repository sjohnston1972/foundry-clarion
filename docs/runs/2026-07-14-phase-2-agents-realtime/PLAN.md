# Foundry Clarion — PLAN.md (Phase 2: Agents, Skills & Realtime Spine)

Autonomous-run plan. Each step is one small, commit-able chunk that ends in a verifiable
check. Do **one step per turn**, commit, append a timestamped line to `PROGRESS.md`.
Full code for each step lives in `docs/superpowers/plans/2026-07-14-foundry-clarion-phase-2.md`
(referenced as "detailed plan, Task N"). **Everything here is local + DRY_RUN — no Cloudflare
account change beyond local D1 and NO live Twilio account mutation.** Stop after Step 10.

**Invariants (apply to every step):** package manager npm; no `any`; `organization_id`/`user_id`
are TEXT; success envelope `{ success, data }`, errors `{ error: { code, message } }`; feature
branch only (`feat/clarion-phase-2-agents-realtime`, never `main`); **never write to
`WORKSPACE_DB`** (read-only bind); every query filters by `organization_id`; secrets never reach
the frontend. Twilio side-effects stay behind `TWILIO_DRY_RUN` (default `"true"`) — do not flip it.

---

1. **Agents migration.** Create `migrations/0002_agents.sql` (`cc_agents`, `cc_skills`,
   `cc_agent_skills`) + `test/agents-migration.test.ts`. *(detailed plan, Task 1)*
   **Verify:** `npx vitest run test/agents-migration.test.ts` → PASS; `npm run d1:migrate:local` applies `0002`.
   **Commit:** `feat: 0002_agents — cc_agents, cc_skills, cc_agent_skills`.

2. **Env + read-only Workspace bind.** Extend `server/types.ts` (Twilio env, `WORKSPACE_DB`,
   `REALTIME`), `wrangler.jsonc` (WORKSPACE_DB bind, DO binding+migration, `TWILIO_DRY_RUN`),
   `.dev.vars`; create `server/db/workspace.ts` (read-only resource/skill accessors) +
   `test/workspace-db.test.ts`. *(detailed plan, Task 2)*
   **Verify:** `npx vitest run test/workspace-db.test.ts && npm run typecheck:server` → green.
   **Commit:** `feat: read-only WORKSPACE_DB binding + resource/skill accessors + Twilio/DO env`.

3. **Clarion agent/skill accessors.** Create `server/db/agents.ts`, `server/db/skills.ts` +
   `test/agents-db.test.ts` (incl. cross-tenant leak assertion). *(detailed plan, Task 3)*
   **Verify:** `npx vitest run test/agents-db.test.ts` → PASS.
   **Commit:** `feat: typed accessors for cc_agents + cc_skills snapshot`.

4. **DRY_RUN provisioning.** Create `server/lib/twilio/provisioning.ts` (`isDryRun`,
   `createWorker`, `ensureTaskRouterWorkspace`) + `test/provisioning.test.ts`. *(detailed plan, Task 4)*
   **Verify:** `npx vitest run test/provisioning.test.ts` → PASS (fake `WKdryrun_` sid, no network).
   **Commit:** `feat: DRY_RUN-gated Twilio provisioning (createWorker/ensureWorkspace)`.

5. **Enable-as-agent.** Create `server/routes/agents.ts` (`POST /agents/enable`, `GET /agents`,
   `GET /agents/candidates`, `POST /agents/status`); mount in `server/app.ts` +
   `test/agents-route.test.ts`. *(detailed plan, Task 5)*
   **Verify:** `npx vitest run test/agents-route.test.ts && npm run typecheck:server` → green.
   **Commit:** `feat: enable-as-agent + agent listing/candidates/status routes (DRY_RUN)`.

6. **Access Token minting.** `npm install jose`; create `server/lib/twilio/token.ts` +
   `server/routes/token.ts` (`POST /token/voice`); mount in `server/app.ts` + `test/token.test.ts`.
   *(detailed plan, Task 6)*
   **Verify:** `npx vitest run test/token.test.ts && npm run typecheck:server` → green.
   **Commit:** `feat: jose-signed Twilio Access Token + POST /api/token/voice`.

7. **Realtime DO.** Create `server/realtime/presence.ts` (pure reducer),
   `server/realtime/clarion-realtime.ts` (`ClarionRealtime` DO); re-export the DO from
   `functions/api/[[route]].ts` + `test/presence.test.ts`. *(detailed plan, Task 7)*
   **Verify:** `npx vitest run test/presence.test.ts && npm run typecheck:server` → green.
   **Commit:** `feat: ClarionRealtime Durable Object + pure presence reducer`.

8. **Realtime route + status push.** Create `server/routes/realtime.ts` (`GET /realtime/socket`,
   `pushPresence`); wire `POST /agents/status` to push; mount in `server/app.ts` +
   `test/realtime-route.test.ts`. *(detailed plan, Task 8)*
   **Verify:** `npx vitest run test/realtime-route.test.ts && npm run typecheck:server` → green.
   **Commit:** `feat: realtime WS route (org DO) + status -> presence push`.

9. **Frontend softphone.** `npm install @twilio/voice-sdk`; create `src/lib/twilio-voice.ts`;
   add a minimal agent panel to `src/App.tsx` (register + status + presence; degrades to
   "not configured" on 503). *(detailed plan, Task 9)*
   **Verify:** `npm run build && npm run lint` → both exit 0.
   **Commit:** `feat: frontend softphone registration + presence panel (Twilio-optional)`.

10. **Green capstone.** Add `docs/phase-2-status.md` summarizing Phase 2 + the STOP boundary.
    *(detailed plan, Task 10)*
    **Verify:** full local gate green — `npm run d1:migrate:local && npx vitest run &&
    npm run typecheck:server && npm run lint && npm run build` all exit 0.
    **Commit:** `docs: Phase 2 complete (agents + token + realtime spine, DRY_RUN-verified)`.
    **Then:** create empty file `DONE` at repo root and stop.

---

## STOP HERE — Phase 3 boundary (needs a LIVE Twilio touch)

Do **not** proceed past Step 10 autonomously. Going live requires Steven in-session:
- Real `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` (+ TwiML App SID) as secrets.
- Create the **shared TaskRouter Workspace** (`ensureTaskRouterWorkspace`, a Twilio account
  mutation) and set `TWILIO_TASKROUTER_WORKSPACE_SID`.
- Flip `TWILIO_DRY_RUN="false"` so `createWorker` provisions real Workers.
- Fill `WORKSPACE_DB` `database_id` from `skills-foundry` and deploy.

Phase 3 (queues, inbound TwiML, live routing → DO) starts there. When all ten steps are done,
create the empty `DONE` file and stop.
