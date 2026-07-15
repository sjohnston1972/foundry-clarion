# Foundry Clarion — Phase 3 + UI run design

Date: 2026-07-15
Status: approved by Steven, 2026-07-15
Branch: `feat/clarion-phase-3-and-ui` (renamed from `feat/realtime-workers-migration`)

## 1. Goal

One run, three arcs:

- **A — close out** the blocked Workers-migration run (its Steps 6–10).
- **B — Phase 3** (queues + inbound calls) built entirely under `TWILIO_DRY_RUN`.
- **C — UI**, taking its look and feel directly from Foundry Workspace.

Every page the run builds is backed by an API the run has actually built, and can be
driven locally by the agent. Nothing is built blind.

## 2. Context: what already exists

Phases 0–2 are built and green (35 tests):

- Auth spine: `verifyFoundrySession` gate in `server/app.ts`, `cc_org_directory`,
  `cc_members`, Clarion-role resolution, `GET /api/auth-status`.
- Agents: `cc_agents`, `cc_skills`, `cc_agent_skills`, enable-as-agent against the
  read-only `WORKSPACE_DB` binding, `/api/agents` (list, candidates, enable, status).
- Twilio Access Token minting (`/api/token/voice`), `TWILIO_DRY_RUN` provisioning
  pattern in `server/lib/twilio/provisioning.ts`.
- Realtime: per-org `ClarionRealtime` Durable Object, `/api/realtime/socket`.
- Hosting: Pages → Workers migration complete (`server/worker.ts`, `wrangler.jsonc`).

The UI is a placeholder: 247 lines total, one centred card in `src/App.tsx`, no router.

## 3. The blocker this run clears, and why the last run was wrong about it

The Workers-migration run stopped at its Step 6 (live WebSocket 101 proof), concluding
there was "no local override in the vendored `@foundry/auth` package."

**That conclusion is incorrect.** `node_modules/@foundry/auth/dist/types.d.ts` exports:

```ts
export interface VerifyOptions {
    jwksUrl?: string;
    issuer?: string;
    audience?: string;
    cookieName?: string;
    /** Advanced/testing escape hatch: supply a key resolver instead of the cached remote JWKS. */
    jwks?: JWTVerifyGetKey;
}
```

and `verifyFoundrySession(req, opts?: VerifyOptions)` accepts it. `server/app.ts` simply
never passes it. AuthPak ships a sanctioned way to verify against a non-remote key.

Two independent gaps follow from having no local session:

1. The real `ClarionRealtime` class is exercised by **no test**.
   `test/realtime-route.test.ts` fakes the DO stub entirely — it proves the route
   forwards an upgrade, not that the DO works.
2. The UI cannot be driven locally at all. Without a session the app can only ever
   render its signed-out state, so any UI built on top of it is built blind.

**Decision (Steven, 2026-07-15): do both.**

- A **workerd integration test** via `@cloudflare/vitest-pool-workers` exercises the real
  DO for a true 101 — permanent, CI-repeatable proof.
- A **dev-only local keypair** wired through `VerifyOptions.jwks`, gated behind a
  `DEV_AUTH` var that defaults off, makes the app drivable locally.

### 3.1 The CLAUDE.md §12 exception

CLAUDE.md §12 says "Do not mint your own tokens for anything AuthPak already covers."
`DEV_AUTH` is a deliberate, narrow exception, and the run writes it into CLAUDE.md with
these boundaries so no future session re-litigates it or quietly widens it:

- `DEV_AUTH` defaults to **off**. Absent or any value but `"true"` ⇒ the dev key resolver
  is never constructed and `verifyFoundrySession` is called exactly as it is today.
- It is honoured **only** under local `wrangler dev` and in tests. It is never set in
  `wrangler.jsonc` production `vars`, never in CI, never in a deployed environment.
- A test asserts that with `DEV_AUTH` unset, a dev-signed token is **rejected**.
- The dev keypair is generated locally and is not an AuthPak key. It cannot produce a
  token any real AuthPak verifier would accept.
- Rail: if `DEV_AUTH` would need to be on anywhere but local `wrangler dev`, the run stops.

## 4. Design system: how Clarion takes Workspace's look

**Constraint (Steven, 2026-07-15): "the UI for Foundry Clarion should take its look and
feel directly from Foundry Workspace — it is supremely important to maintain the look and
feel as they are two tightly coupled apps."**

### 4.1 What ports, what doesn't

`skills-foundry/src/components/ui.tsx` (188 lines) is self-contained and **is** the look
and feel: `Card`, `CardHead`, `Button`, `Badge`, `Stat`, `Spinner`, `EmptyState`,
`Loader`, `Skeleton`, `TableSkeleton`, `ErrorState`. Its only dependencies are
`lucide-react` and a two-line `cn` helper over `clsx` + `tailwind-merge`.

`skills-foundry/src/components/AppShell.tsx` (641 lines) does **not** port. It is wired
into Workspace's own domain — departments, plans, billing, tickets, command palette.
Clarion builds its own shell mirroring its *structure*, not copying the file.

Clarion's `index.html` already loads the identical font stack (Inter / Space Grotesk /
JetBrains Mono). No change needed.

### 4.2 Existing drift (must be fixed before any page is built)

`src/index.css` describes itself as a "minimal token set" and is missing, versus Workspace:
`--color-raised`, `--color-faint`, `--color-ink-2`, `--color-line-2`, `--color-accent-soft`,
`--radius-card`, `--shadow-card`, `--shadow-pop`, the `.tabular` readout class, and the
scrollbar styling.

This is load-bearing: `ui.tsx` references `--radius-card` and `--shadow-card` directly, so
porting the primitives without the full token block renders them silently wrong.

### 4.3 Mechanism: vendored snapshot + drift test

- Copy Workspace's full `@theme` block and `ui.tsx` **verbatim** into Clarion.
- Each vendored file carries a provenance header naming source repo, path, and commit.
  Baselines at authoring time: `skills-foundry` HEAD `29ed077`; `src/index.css` last
  touched `35e268c`; `src/components/ui.tsx` last touched `673b50c`.
- A **drift test** re-reads the sibling repo and fails when Workspace's copy has changed,
  making divergence a visible failure rather than a slow rot. It **skips** when the sibling
  isn't on disk, so CI is unaffected.
- Workspace sets `--accent` at runtime per department. Clarion is one app: it keeps the
  same variable indirection so it *can* be themed, with the accent fixed at `#00a3ff`.

Clarion is read-only on `skills-foundry` (CLAUDE.md §4), so a real shared `@foundry/ui`
package is out of scope for this run.

## 5. Steps

Arc A — close out:

1. Dev auth: local keypair via `VerifyOptions.jwks` behind `DEV_AUTH` (default off) + tests.
2. workerd integration test (`@cloudflare/vitest-pool-workers`): real DO, true 101, fan-out.
3. Live 101 under `wrangler dev` with `DEV_AUTH=true` (the original Step 6).
4. DO socket identity + cleanup (the original Step 7).
5. Docs: CLAUDE.md §8 fix (it still describes the deleted `functions/api/[[route]].ts`),
   §12 dev-auth exception, design-system section.

Arc B — Phase 3, dry-run only:

6. Migration `0003`: `cc_queues`, `cc_queue_members`, `cc_calls` + typed accessors + tests.
7. Queues routes + TaskRouter Workflow provisioning (dry-run) + tests.
8. Inbound TwiML + status webhooks → org DO → `cc_calls`, with signature validation + tests.

Arc C — UI:

9. **Linchpin.** Design-system port: full token block + `ui.tsx` vendored with provenance,
   deps (`clsx`, `tailwind-merge`, `lucide-react`), drift test, Playwright installed.
10. `AppShell` (router, sidebar nav mirroring Workspace's structure) + `AuthGate` refactor.
11. Agents page (list, candidates, enable-as-agent).
12. Queues page (against Arc B's dry-run APIs).
13. Softphone page (register, status, live presence) replacing the placeholder card.
14. Wallboard scaffold (subscribes to the DO stream, renders presence; no call events yet).

15. Capstone: full gate green, archive, DONE.

Ordering is deliberate. Arc A first because it produces the dev session everything else is
verified with; Arc C's Queues page needs Arc B. If the run dies partway it dies at a
coherent boundary.

## 6. Rails (pre-decided — the run never needs Steven)

- **Step 9 is the linchpin.** Its done condition is not "tokens copied" — it is a passing
  drift test *plus* a Playwright screenshot of a page rendering the vendored
  `Card`/`Button`/`Badge`. If Step 9 can't go green, the run **stops** rather than
  building four pages on a broken foundation.
- If the Playwright browser download fails: note it in PROGRESS.md, fall back to
  `@testing-library/react` + jsdom for component assertions plus a `fetch` check on the
  served HTML, and carry on. Do **not** claim UI verification that didn't happen.
- If any Twilio call would go live (`TWILIO_DRY_RUN=false`), the run **stops**. Buying a
  number and creating a Workflow need Steven in-session (CLAUDE.md §4, §12).
- If `DEV_AUTH` would need to be on outside local `wrangler dev`, the run **stops**.
- No writes or commits in `authpak/` or `skills-foundry/` — read-only, always (§4).
- Wallboard stays a scaffold. Monitor/whisper/barge is Phase 5 and out of scope.

## 7. Explicitly not in this run

- Live Twilio account mutation of any kind.
- Recording capture, R2, transcripts, reporting (Phase 4).
- Supervisor monitor/whisper/barge, outbound click-to-call (Phase 5).
- A shared `@foundry/ui` package (needs a Workspace-side change; Clarion is read-only).
- Pushing `main`, or merging this branch. Steven owns both.
