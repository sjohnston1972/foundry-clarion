# Foundry Clarion — Phase 2 status

**Status:** complete, all verification local + `TWILIO_DRY_RUN="true"` (no live Twilio, no
Cloudflare account change). Branch: `feat/clarion-phase-2-agents-realtime`. See `PLAN.md` /
`PROGRESS.md` for the step-by-step handoff log, and
`docs/superpowers/plans/2026-07-14-foundry-clarion-phase-2.md` for the full detailed plan.

## Delivered (local + DRY_RUN, no live Twilio)

- **`0002_agents` migration** — `cc_agents`, `cc_skills`, `cc_agent_skills`.
- **Read-only `WORKSPACE_DB` binding** + accessors (`server/db/workspace.ts`) for
  resources/skills by org + email — Clarion never writes to Workspace's D1.
- **Enable-as-agent flow** — match Workspace resource by email → DRY_RUN Twilio Worker
  (`server/lib/twilio/provisioning.ts`) → `cc_agents` row → skill snapshot into
  `cc_agent_skills` → audit log entry.
- **Agent listing / candidates / self-status routes** (`server/routes/agents.ts`) — org-scoped,
  role-guarded, mounted behind the auth gate.
- **jose-signed Twilio Access Token minting** (`server/lib/twilio/token.ts`) +
  `POST /api/token/voice` (503/403/409 branches for not-configured / wrong-role / not-an-agent).
- **`ClarionRealtime` per-org Durable Object** (`server/realtime/clarion-realtime.ts`) — pure
  presence reducer (`server/realtime/presence.ts`), hibernatable WS hub, state persisted to
  `ctx.storage`; `GET /realtime/socket` route + `POST /agents/status` pushes presence into
  the org's DO.
- **Frontend softphone** — `src/lib/twilio-voice.ts` + a softphone/presence panel in
  `src/App.tsx`'s app-gate (register / status / presence); degrades to "not configured" when
  Twilio credentials aren't wired.

## Verification (all local)

Full local gate green, run in this session:

- `npm run d1:migrate:local` — `✅ No migrations to apply!` (`0002_agents` was already applied
  by Step 1 of this run; re-run is idempotent).
- `npx vitest run` — **14 test files, 35 tests, all passing** (agents-migration, workspace-db,
  agents-db, provisioning, agents-route, token, presence, realtime-route, plus the Phase 0–1
  suite: health, db, auth, app-auth, session, migration).
- `npm run typecheck:server` — clean, exit 0.
- `npm run lint` (oxlint) — clean, exit 0.
- `npm run build` (`tsc -b && vite build`) — clean, exit 0; `dist/` produced
  (`index.html`, CSS, JS bundle).

**Integration probe (`wrangler pages dev`):** the public routes were exercised end-to-end.
`wrangler pages dev` bound both D1 databases (`DB` and the read-only `WORKSPACE_DB`, even with
its `REPLACE_WITH_WORKSPACE_DB_ID` placeholder `database_id`) without any local-D1 workaround —
Wrangler treats the placeholder as an opaque local-persistence key, so the "known integration
risk" flagged for `WORKSPACE_DB` in the plan's self-review did not materialize.

The blocker that did appear is the other flagged risk: Wrangler's Pages Functions bundler does
not preserve the `ClarionRealtime` Durable Object export through its `functionsWorker-*.mjs`
build step, even though it **is** exported correctly from the entrypoint
(`functions/api/[[route]].ts` exports both `onRequest` and `ClarionRealtime`, confirmed by
reading the file). Two runs (manual `wrangler pages dev dist ...` and the `npm run pages:dev`
script) both failed identically at startup:

```
✘ [ERROR] Your Worker depends on the following Durable Objects, which are not exported in your
entrypoint file: ClarionRealtime.
```

This is a Pages-Functions-directory bundling limitation (the bundler appears to tree-shake
named exports other than `onRequest`), not a code defect — `ClarionRealtime` and its logic are
covered by `test/presence.test.ts` and `test/realtime-route.test.ts` under vitest instead.

**Workaround used to still verify the HTTP surface:** temporarily removed the `durable_objects`
binding from `wrangler.jsonc` (kept both D1 bindings and every other setting untouched, no
`database_id` filled in, `TWILIO_DRY_RUN` untouched), started `wrangler pages dev dist` in the
background, curled the two target endpoints, then restored `wrangler.jsonc` from a backup
(`git diff --stat wrangler.jsonc` confirmed byte-identical afterward) and stopped the server.
Results:

```
curl http://127.0.0.1:8788/api/health
{"success":true,"status":"healthy","database":"connected","timestamp":"2026-07-14T22:24:28.103Z"}

curl http://127.0.0.1:8788/api/auth-status
{"success":true,"data":{"authenticated":false,"hasOrg":false,"email":null,"orgId":null,"orgSlug":null,"orgRole":null,"clarionRole":null,"disabled":false}}
```

Both match the expected shapes exactly. The DO-bound path (`GET /realtime/socket`,
`POST /api/token/voice`'s TaskRouter grant, presence push) was **not** exercised through
`wrangler pages dev` in this session because of the bundler limitation above — it remains
verified at the unit level only. Authenticated agent/token/WS flows also still need a real
`fnd_session` cookie + Twilio creds, as already flagged in the plan; both are Phase-3
follow-ups, not Phase-2 blockers.

## STOP boundary — Phase 3 needs live Twilio

Everything above runs with `TWILIO_DRY_RUN="true"`. Going live requires Steven in-session:

- Add real `TWILIO_API_KEY_SID` / `TWILIO_API_KEY_SECRET` (+ TwiML App SID) to secrets.
- Create the **shared TaskRouter Workspace** (`ensureTaskRouterWorkspace`, account mutation)
  and set `TWILIO_TASKROUTER_WORKSPACE_SID`.
- Flip `TWILIO_DRY_RUN="false"` so `createWorker` provisions real Workers.
- Fill `WORKSPACE_DB` `database_id` from `skills-foundry` and deploy.
- Resolve the `wrangler pages dev` + Durable Object bundling gap noted above (or verify it only
  affects local dev and not the deployed Pages build) before relying on the DO in an
  integration test.

Phase 3 (queues, inbound TwiML, live routing → DO) starts here. Do not proceed past this
boundary autonomously.
