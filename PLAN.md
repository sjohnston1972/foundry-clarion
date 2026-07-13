# Foundry Clarion — PLAN.md (Phase 0–1: Bootstrap + Auth Spine)

Autonomous-run plan. Each step is one small, commit-able chunk that ends in a verifiable
check. Do **one step per turn**, commit, append a timestamped line to `PROGRESS.md`.
Full code for each step lives in `docs/superpowers/plans/2026-07-13-foundry-clarion-phase-0-1.md`
(referenced as "detailed plan, Task N"). **Everything here is local — no Cloudflare account
change and no Twilio.** Stop after Step 10.

**Invariants (apply to every step):** package manager npm; no `any`; `org_id`/`user_id` are
TEXT; success envelope `{ success, data }`, errors `{ error: { code, message } }`; feature
branch only (never `main`); never write to Workspace's DB. Cookie/JWT contract is fixed:
`fnd_session`, issuer `authpak.foundry-ns.com`, aud `foundry-ns`.

---

1. **Scaffold & install.** Create `package.json`, `wrangler.jsonc` (D1 binding
   `DB`→`foundry-clarion-db`, placeholder `database_id` — local only), `tsconfig.json`,
   `tsconfig.server.json`, `vite.config.ts`, `vitest.config.ts`; copy
   `../skills-foundry/vendor/foundry-auth-0.1.0.tgz` → `vendor/`. (`.gitignore` already
   present.) *(detailed plan, Task 1)*
   **Verify:** `npm install` exits 0 and `node -e "require('@foundry/auth')"` resolves.
   **Commit:** `chore: scaffold foundry-clarion (Pages + Hono + D1 + @foundry/auth)`.

2. **Base migration.** Create `migrations/0001_init.sql` (`cc_org_directory`, `cc_members`
   with `clarion_role` CHECK, `cc_audit_log`) and `test/migration.test.ts`.
   *(detailed plan, Task 4)*
   **Verify:** `npm run d1:migrate:local` → "1 migration applied"; `npx vitest run
   test/migration.test.ts` → PASS.
   **Commit:** `feat: 0001_init — cc_org_directory, cc_members, cc_audit_log`.

3. **Health endpoint.** Create `server/types.ts`, `server/lib/http.ts`,
   `server/routes/health.ts`, `server/app.ts`, `functions/api/[[route]].ts`, and
   `test/health.test.ts`. *(detailed plan, Task 3)*
   **Verify:** `npx vitest run test/health.test.ts` → PASS (asserts HTTP 200 +
   `{ status: 'healthy', database: 'connected' }`).
   **Commit:** `feat: health route + Pages Function entry`.

4. **DB accessors.** Create `server/db/members.ts` (`getClarionRole` / `setClarionRole`,
   type `ClarionRole`) and `server/db/directory.ts` (`touchOrgDirectory`); add
   `test/db.test.ts`. *(detailed plan, Task 5)*
   **Verify:** `npx vitest run test/db.test.ts` → PASS.
   **Commit:** `feat: typed accessors for cc_members + cc_org_directory`.

5. **Role resolution & guard.** Create `server/lib/auth.ts` — `resolveClarionRole(db, claims)`
   (returns stored role; bootstraps an org `owner`/`admin` with no row to Clarion `admin`;
   else `null`) and `requireClarionRole(min)` middleware; add `test/auth.test.ts`.
   *(detailed plan, Task 6)*
   **Verify:** `npx vitest run test/auth.test.ts` → PASS (stored-role, owner-bootstrap,
   member-null cases).
   **Commit:** `feat: Clarion role resolution + requireClarionRole guard`.

6. **Auth gate + identity endpoints.** Wire the `verifyFoundrySession` middleware into
   `server/app.ts`; add public `GET /api/auth-status`; add `server/routes/me.ts`
   (`GET /api/me`); add `test/app-auth.test.ts` (mocks `@foundry/auth`). *(detailed plan, Task 7)*
   **Verify:** `npx vitest run test/app-auth.test.ts` → PASS: auth-status 200 while
   logged-out; `/api/me` 401 with no session under `AUTH_ENFORCE=true`; `/api/me` 200 with
   `connectRole: 'admin'` for an owner session.
   **Commit:** `feat: AuthPak session gate + /api/auth-status + /api/me`.

7. **CI + quality gate.** Add `.github/workflows/ci.yml` (typecheck + build + test on
   push/PR, mirroring `skills-foundry/.github/workflows/ci.yml`).
   **Verify:** locally run the same gate — `npx vitest run && npm run typecheck:server &&
   npm run lint` — all exit 0.
   **Commit:** `ci: typecheck/build/test workflow`.

8. **SPA session logic.** Create `src/lib/session.ts` — `classifyGate(status)` →
   `'signed-out' | 'no-access' | 'app'` and `fetchAuthStatus()`; add `test/session.test.ts`.
   *(detailed plan, Task 8)*
   **Verify:** `npx vitest run test/session.test.ts` → PASS.
   **Commit:** `feat: SPA gate classification (signed-out / no-access / app)`.

9. **SPA shell.** Create `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
   (renders the three gate states using the design tokens; signed-out links to
   `https://authpak.foundry-ns.com/login?redirect_uri=<current>`). *(detailed plan, Task 8)*
   **Verify:** `npm run build` exits 0 and `dist/index.html` exists.
   **Commit:** `feat: minimal SPA auth-gate shell`.

10. **Green capstone.** Add `docs/phase-0-1-status.md` summarizing what Phase 0–1 delivers
    and the STOP boundary below.
    **Verify:** full local gate green — `npm run d1:migrate:local && npx vitest run &&
    npm run build && npm run lint` all exit 0.
    **Commit:** `docs: Phase 0–1 complete (auth spine, local-verified)`.
    **Then:** create empty file DONE at repo root and stop.

---

## STOP HERE — Phase 2 boundary (needs a Twilio touch)

Do **not** proceed past Step 10 autonomously. The next work (enable-as-agent, minting Twilio
Access Tokens, creating the shared TaskRouter Workspace) requires `TWILIO_API_KEY_SID` /
`TWILIO_API_KEY_SECRET` (not yet in `.env`) and Twilio account mutations that need Steven's
explicit in-session "go". Also deferred to deploy time: the real `wrangler d1 create
foundry-clarion-db` (Steps 1–10 use local D1 only). When all ten steps are done, create the
empty `DONE` file and stop.
