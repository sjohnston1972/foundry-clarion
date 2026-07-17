# Queue & Agent Admin Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins UI + API to delete queues, choose a queue's call-distribution algorithm from a validated set, and disable an enabled agent — all inside the existing dry-run rails.

**Architecture:** `strategy` becomes a validated enum shared server↔client. Queue delete already exists server-side (needs only UI + audit). Agent disable is a new org-scoped `DELETE /api/agents/:id` mirroring the recordings 404 pattern, with a cascade delete, audit row, and best-effort realtime presence drop. Real TaskRouter teardown/routing is out of scope (Phase 5).

**Tech Stack:** TypeScript, Hono (Cloudflare Workers), D1, React 19 + Vite + Tailwind v4, `@tanstack/react-query` v5, Vitest.

## Global Constraints

- No real Twilio calls: provisioning stays behind `TWILIO_DRY_RUN`; no code path may hit `taskrouter.twilio.com`. (Copied verbatim intent from spec "Rails assertion".)
- Distribution strategies are exactly: `longest-idle`, `round-robin`, `ring-all`, `priority`.
- Cross-org access returns **404, never 403**.
- Error responses are JSON `{ error: { code, message } }` via `err(c, code, message, status)`.
- Every table access goes through a typed accessor in `server/db/*.ts` — no raw SQL in handlers.
- No `any`. Files stay focused/small (<~300 lines).
- Audit actions to emit: `queue.delete`, `queue.strategy`, `agent.disable` (precedent: `agent.enable`).

---

### Task 1: Distribution-strategy enum module

**Files:**
- Create: `server/lib/queues/strategies.ts`
- Test: `test/strategies.test.ts`

**Interfaces:**
- Produces:
  - `QUEUE_STRATEGIES: readonly ['longest-idle','round-robin','ring-all','priority']`
  - `type QueueStrategy = typeof QUEUE_STRATEGIES[number]`
  - `isQueueStrategy(x: unknown): x is QueueStrategy`
  - `QUEUE_STRATEGY_LABELS: Record<QueueStrategy, string>`
  - `DEFAULT_QUEUE_STRATEGY: QueueStrategy` (= `'longest-idle'`)

- [ ] **Step 1: Write the failing test**

```ts
// test/strategies.test.ts
import { describe, it, expect } from 'vitest'
import {
  QUEUE_STRATEGIES, isQueueStrategy, QUEUE_STRATEGY_LABELS, DEFAULT_QUEUE_STRATEGY,
} from '../server/lib/queues/strategies'

describe('queue strategies', () => {
  it('exposes exactly the four agreed strategies', () => {
    expect([...QUEUE_STRATEGIES]).toEqual(['longest-idle', 'round-robin', 'ring-all', 'priority'])
  })
  it('accepts valid values and rejects everything else', () => {
    expect(isQueueStrategy('round-robin')).toBe(true)
    expect(isQueueStrategy('ring-all')).toBe(true)
    expect(isQueueStrategy('nonsense')).toBe(false)
    expect(isQueueStrategy(null)).toBe(false)
    expect(isQueueStrategy(3)).toBe(false)
  })
  it('has a human label for every strategy and a sane default', () => {
    for (const s of QUEUE_STRATEGIES) expect(QUEUE_STRATEGY_LABELS[s].length).toBeGreaterThan(0)
    expect(DEFAULT_QUEUE_STRATEGY).toBe('longest-idle')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/strategies.test.ts`
Expected: FAIL — cannot resolve `../server/lib/queues/strategies`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/lib/queues/strategies.ts
export const QUEUE_STRATEGIES = ['longest-idle', 'round-robin', 'ring-all', 'priority'] as const

export type QueueStrategy = typeof QUEUE_STRATEGIES[number]

export const DEFAULT_QUEUE_STRATEGY: QueueStrategy = 'longest-idle'

export function isQueueStrategy(x: unknown): x is QueueStrategy {
  return typeof x === 'string' && (QUEUE_STRATEGIES as readonly string[]).includes(x)
}

export const QUEUE_STRATEGY_LABELS: Record<QueueStrategy, string> = {
  'longest-idle': 'Longest idle',
  'round-robin': 'Round robin',
  'ring-all': 'Ring all',
  priority: 'Priority order',
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/strategies.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/lib/queues/strategies.ts test/strategies.test.ts
git commit -m "feat: validated queue distribution-strategy enum + labels"
```

---

### Task 2: Queue route — strategy validation + delete/strategy audit

**Files:**
- Modify: `server/routes/queues.ts` (POST create, PATCH update, DELETE)
- Test: `test/queues-route.test.ts` (extend)

**Interfaces:**
- Consumes: `isQueueStrategy`, `DEFAULT_QUEUE_STRATEGY` (Task 1); `insertAuditLog` from `server/db/audit`.
- Produces: `POST /api/queues` and `PATCH /api/queues/:id` reject invalid `strategy` with 400; `PATCH` strategy change writes a `queue.strategy` audit row; `DELETE /api/queues/:id` writes a `queue.delete` audit row.

- [ ] **Step 1: Write the failing tests**

Append to `test/queues-route.test.ts`. First extend `fakeDb` to support delete + audit capture: replace its `run()` body and add an `audits`/removal capability by replacing the whole `fakeDb` function with this version (keeps existing behaviour, adds DELETE + audit + `__audits`):

```ts
function fakeDb(clarionRole: 'agent' | 'supervisor' | null) {
  const queues: Record<string, unknown>[] = []
  const members: Record<string, unknown>[] = []
  const audits: { action: string; meta: string }[] = []
  const db = {
    __audits: audits,
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return clarionRole ? { clarion_role: clarionRole } : null
            if (sql.includes('FROM cc_queues')) return queues.find((q) => q.organization_id === a[0] && q.id === a[1]) ?? null
            return null
          },
          async all() {
            if (sql.includes('FROM cc_queues')) return { results: queues.filter((q) => q.organization_id === a[0]) }
            if (sql.includes('FROM cc_queue_members')) return { results: members.filter((m) => m.queue_id === a[0]) }
            return { results: [] }
          },
          async run() {
            if (sql.startsWith('INSERT INTO cc_queues')) queues.push({ id: a[0], organization_id: a[1], name: a[2], twilio_workflow_sid: a[3], strategy: a[4] })
            if (sql.startsWith('INSERT INTO cc_queue_members')) members.push({ queue_id: a[0], agent_id: a[1], priority: a[2] })
            if (sql.startsWith('UPDATE cc_queues SET strategy')) { const q = queues.find((x) => x.organization_id === a[1] && x.id === a[2]); if (q) q.strategy = a[0] }
            if (sql.startsWith('DELETE FROM cc_queues')) { const i = queues.findIndex((x) => x.organization_id === a[0] && x.id === a[1]); if (i >= 0) queues.splice(i, 1) }
            if (sql.startsWith('INSERT INTO cc_audit_log')) audits.push({ action: String(a[2]), meta: String(a[3]) })
            return {}
          },
        }),
      }
    },
  }
  return db as unknown as D1Database & { __audits: { action: string; meta: string }[] }
}
```

Then add this describe block:

```ts
describe('queues route — strategy validation + audit', () => {
  it('rejects an unknown strategy on create', async () => {
    const res = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Support', strategy: 'nonsense' }),
    }, env(null))
    expect(res.status).toBe(400)
  })
  it('accepts a valid strategy on create and persists it', async () => {
    const res = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Sales', strategy: 'ring-all' }),
    }, env(null))
    expect(res.status).toBe(201)
    expect((await res.json()).data.strategy).toBe('ring-all')
  })
  it('rejects an unknown strategy on patch', async () => {
    const e = env(null)
    const create = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Support' }),
    }, e)
    const id = (await create.json()).data.id
    const res = await createApp().request(`/api/queues/${id}`, {
      method: 'PATCH', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ strategy: 'nope' }),
    }, e)
    expect(res.status).toBe(400)
  })
  it('changes strategy on patch and writes a queue.strategy audit row', async () => {
    const e = env(null)
    const create = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Support' }),
    }, e)
    const id = (await create.json()).data.id
    const res = await createApp().request(`/api/queues/${id}`, {
      method: 'PATCH', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ strategy: 'priority' }),
    }, e)
    expect(res.status).toBe(200)
    expect((await res.json()).data.strategy).toBe('priority')
    expect((e.DB as unknown as { __audits: { action: string }[] }).__audits.map((x) => x.action)).toContain('queue.strategy')
  })
  it('writes a queue.delete audit row and cross-org delete is 404', async () => {
    const e = env(null)
    const create = await createApp().request('/api/queues', {
      method: 'POST', headers: { cookie: 'fnd_session=admin', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Support' }),
    }, e)
    const id = (await create.json()).data.id
    const del = await createApp().request(`/api/queues/${id}`, { method: 'DELETE', headers: { cookie: 'fnd_session=admin' } }, e)
    expect(del.status).toBe(200)
    expect((e.DB as unknown as { __audits: { action: string }[] }).__audits.map((x) => x.action)).toContain('queue.delete')
    const again = await createApp().request(`/api/queues/${id}`, { method: 'DELETE', headers: { cookie: 'fnd_session=admin' } }, e)
    expect(again.status).toBe(404)
  })
})
```

Note: `env(null)` must return a **stable** DB per call so create+patch+delete share state. The existing `env` builds a fresh `fakeDb` each call — change `env` to memoize is unnecessary because each test above calls `env(null)` **once** and reuses `e`. Keep `env` as-is.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/queues-route.test.ts`
Expected: FAIL — invalid strategy currently returns 201 (not 400); no audit rows recorded.

- [ ] **Step 3: Write the implementation**

Edit `server/routes/queues.ts`. Add imports at top:

```ts
import { isQueueStrategy, DEFAULT_QUEUE_STRATEGY } from '../lib/queues/strategies'
import { insertAuditLog } from '../db/audit'
```

Replace the POST strategy line + creation block (lines ~37-43) so strategy is validated:

```ts
  let strategy = DEFAULT_QUEUE_STRATEGY
  if (body.strategy !== undefined) {
    if (!isQueueStrategy(body.strategy)) return err(c, 'bad_input', 'unknown strategy', 400)
    strategy = body.strategy
  }

  const workflow = await createWorkflow(c.env, { orgId, friendlyName: name, configuration: {} })

  const id = crypto.randomUUID()
  await insertQueue(c.env.DB, { id, organizationId: orgId, name, twilioWorkflowSid: workflow.workflowSid, strategy })
  return c.json({ success: true, data: { id, organizationId: orgId, name, twilioWorkflowSid: workflow.workflowSid, strategy } }, 201)
```

Replace the PATCH body-handling block (lines ~52-58) with validation + audit:

```ts
  let body: { name?: unknown; strategy?: unknown }
  try { body = await c.req.json() } catch { return err(c, 'bad_json', 'Invalid JSON body', 400) }
  const patch: { name?: string; strategy?: string } = {}
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (body.strategy !== undefined) {
    if (!isQueueStrategy(body.strategy)) return err(c, 'bad_input', 'unknown strategy', 400)
    patch.strategy = body.strategy
  }
  await updateQueue(c.env.DB, orgId, existing.id, patch)
  if (patch.strategy) {
    await insertAuditLog(c.env.DB, { organizationId: orgId, userId: c.get('user')?.id ?? null, action: 'queue.strategy', meta: { queueId: existing.id, strategy: patch.strategy } })
  }
  return c.json({ success: true, data: await getQueueById(c.env.DB, orgId, existing.id) })
```

In the DELETE handler (after `deleteQueue(...)`, before the return), add the audit row:

```ts
  await deleteQueue(c.env.DB, orgId, existing.id)
  await insertAuditLog(c.env.DB, { organizationId: orgId, userId: c.get('user')?.id ?? null, action: 'queue.delete', meta: { queueId: existing.id, name: existing.name } })
  return c.json({ success: true, data: { id: existing.id } })
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/queues-route.test.ts`
Expected: PASS (existing gate tests + 5 new).

- [ ] **Step 5: Commit**

```bash
git add server/routes/queues.ts test/queues-route.test.ts
git commit -m "feat: validate queue strategy + audit queue delete/strategy changes"
```

---

### Task 3: Agent db accessors — getAgentById + deleteAgent

**Files:**
- Modify: `server/db/agents.ts` (add two exports)
- Test: `test/agents-db.test.ts` (extend)

**Interfaces:**
- Consumes: existing `Agent`, `AgentRow`, `toAgent`, `COLS`, `insertAgent`, `getAgentByEmail`.
- Produces:
  - `getAgentById(db: D1Database, orgId: string, id: string): Promise<Agent | null>`
  - `deleteAgent(db: D1Database, orgId: string, id: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

Append to `test/agents-db.test.ts`. Add the imports to the top import line:

```ts
import { insertAgent, getAgentByEmail, listAgents, getAgentById, deleteAgent } from '../server/db/agents'
```

Extend `memDb`'s `first()` to distinguish an id-lookup (the SELECT-by-id has `AND id = ?`, whereas by-email has `AND email = ?`). Replace the `first()` in `bindThen` with:

```ts
    async first() {
      if (sql.includes('FROM cc_agents') && sql.includes('AND id = ?')) return agents.find((a) => a.organization_id === args[0] && a.id === args[1]) ?? null
      if (sql.includes('FROM cc_agents') && sql.includes('email')) return agents.find((a) => a.organization_id === args[0] && a.email === args[1]) ?? null
      if (sql.includes('FROM cc_skills')) return skills.find((s) => s.organization_id === args[0] && s.name === args[1]) ?? null
      return null
    },
```

And extend `run()` to handle the delete:

```ts
    async run() {
      if (sql.startsWith('INSERT INTO cc_agents')) agents.push({ id: args[0], organization_id: args[1], user_id: args[2], email: args[3], workspace_resource_id: args[4], twilio_worker_sid: args[5], status: 'offline', activity_sid: null })
      if (sql.startsWith('INSERT INTO cc_skills')) skills.push({ id: args[0], organization_id: args[1], name: args[2] })
      if (sql.startsWith('DELETE FROM cc_agents')) { const i = agents.findIndex((a) => a.organization_id === args[0] && a.id === args[1]); if (i >= 0) agents.splice(i, 1) }
      return {}
    },
```

Add this describe block:

```ts
describe('cc_agents get-by-id + delete', () => {
  it('reads an agent by id and deletes it, org-scoped', async () => {
    const db = memDb()
    await insertAgent(db, { id: 'a1', organizationId: 'o1', userId: null, email: 'ada@x.com', workspaceResourceId: null, twilioWorkerSid: null })
    expect((await getAgentById(db, 'o1', 'a1'))?.email).toBe('ada@x.com')
    expect(await getAgentById(db, 'o2', 'a1')).toBeNull() // cross-org: not found
    await deleteAgent(db, 'o2', 'a1') // wrong org: no-op
    expect(await getAgentById(db, 'o1', 'a1')).not.toBeNull()
    await deleteAgent(db, 'o1', 'a1')
    expect(await getAgentById(db, 'o1', 'a1')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agents-db.test.ts`
Expected: FAIL — `getAgentById`/`deleteAgent` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `server/db/agents.ts`:

```ts
export async function getAgentById(db: D1Database, orgId: string, id: string): Promise<Agent | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM cc_agents WHERE organization_id = ? AND id = ?`)
    .bind(orgId, id)
    .first<AgentRow>()
  return row ? toAgent(row) : null
}

export async function deleteAgent(db: D1Database, orgId: string, id: string): Promise<void> {
  await db.prepare(`DELETE FROM cc_agents WHERE organization_id = ? AND id = ?`).bind(orgId, id).run()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agents-db.test.ts`
Expected: PASS (existing + 1 new).

- [ ] **Step 5: Commit**

```bash
git add server/db/agents.ts test/agents-db.test.ts
git commit -m "feat: getAgentById + deleteAgent db accessors (org-scoped)"
```

---

### Task 4: Disable-agent route — DELETE /api/agents/:id

**Files:**
- Modify: `server/routes/agents.ts`
- Test: `test/agents-route.test.ts` (extend)

**Interfaces:**
- Consumes: `getAgentById`, `deleteAgent` (Task 3); `insertAuditLog`; `pushPresence`.
- Produces: `DELETE /api/agents/:id` (admin) → 200 `{ id }` on success, 404 if not found / cross-org; writes `agent.disable` audit; best-effort presence drop.

- [ ] **Step 1: Write the failing test**

Append to `test/agents-route.test.ts`. This test uses its own fake DB + a REALTIME stub that records presence, so we can assert both audit and presence. Add at the end of the file:

```ts
describe('disable-as-agent', () => {
  function disableDb() {
    const agents: Record<string, unknown>[] = [{ id: 'a1', organization_id: 'o1', email: 'agent@acme.com', twilio_worker_sid: 'WKdryrun_a1', status: 'offline', activity_sid: null, user_id: null, workspace_resource_id: 'r1' }]
    const audits: { action: string }[] = []
    const db = {
      __audits: audits,
      prepare(sql: string) {
        return { bind: (...a: unknown[]) => ({
          async first() {
            if (sql.includes('FROM cc_org_directory')) return { disabled: 0 }
            if (sql.includes('FROM cc_members')) return null // owner -> admin bootstrap
            if (sql.includes('FROM cc_agents') && sql.includes('AND id = ?')) return agents.find((x) => x.organization_id === a[0] && x.id === a[1]) ?? null
            return null
          },
          async all() { return { results: agents } },
          async run() {
            if (sql.startsWith('DELETE FROM cc_agents')) { const i = agents.findIndex((x) => x.organization_id === a[0] && x.id === a[1]); if (i >= 0) agents.splice(i, 1) }
            if (sql.startsWith('INSERT INTO cc_audit_log')) audits.push({ action: String(a[2]) })
            return {}
          },
        }) }
      },
    }
    return db as unknown as D1Database & { __audits: { action: string }[] }
  }
  function disableEnv() {
    const presence: unknown[] = []
    const REALTIME = {
      idFromName: () => 'id',
      get: () => ({ fetch: async (_u: string, init: { body: string }) => { presence.push(JSON.parse(init.body)); return new Response('ok') } }),
    }
    return { DB: disableDb(), REALTIME, __presence: presence, AUTH_ENFORCE: 'true', TWILIO_DRY_RUN: 'true' } as never
  }

  it('deletes the agent row, audits agent.disable, drops presence', async () => {
    const e = disableEnv()
    const res = await createApp().request('/api/agents/a1', { method: 'DELETE', headers: { cookie: 'fnd_session=owner' } }, e)
    expect(res.status).toBe(200)
    expect((e as unknown as { DB: { __audits: { action: string }[] } }).DB.__audits.map((x) => x.action)).toContain('agent.disable')
    expect((e as unknown as { __presence: { identity: string; status: string }[] }).__presence[0].status).toBe('offline')
    // second delete: gone -> 404
    const again = await createApp().request('/api/agents/a1', { method: 'DELETE', headers: { cookie: 'fnd_session=owner' } }, e)
    expect(again.status).toBe(404)
  })
  it('cross-org / unknown id is 404', async () => {
    const res = await createApp().request('/api/agents/ghost', { method: 'DELETE', headers: { cookie: 'fnd_session=owner' } }, disableEnv())
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/agents-route.test.ts`
Expected: FAIL — `DELETE /api/agents/:id` route does not exist (Hono returns 404 for a different reason, but the audit/presence assertions fail).

- [ ] **Step 3: Write the implementation**

Edit `server/routes/agents.ts`. Update the import from `../db/agents` to include the new accessors:

```ts
import { insertAgent, getAgentByEmail, getAgentById, deleteAgent, listAgents, setAgentStatus, type Agent } from '../db/agents'
```

Add this route (place it after the `POST /status` handler, before the final `export`-adjacent close — i.e. as the last `agents.*` handler):

```ts
// DELETE /api/agents/:id — disable an enabled agent (admin). Inverse of enable.
agents.delete('/:id', requireClarionRole('admin'), async (c) => {
  const orgId = c.get('organizationId')
  if (!orgId) return err(c, 'no_org', 'No organization in session', 400)
  const agent = await getAgentById(c.env.DB, orgId, c.req.param('id'))
  if (!agent) return err(c, 'not_found', 'Agent not found', 404) // cross-org lands here too: 404, never 403

  await deleteAgent(c.env.DB, orgId, agent.id) // cc_agent_skills cascade; cc_calls.agent_id -> NULL (history kept)
  await insertAuditLog(c.env.DB, {
    organizationId: orgId, userId: c.get('user')?.id ?? null,
    action: 'agent.disable', meta: { agentId: agent.id, email: agent.email },
  })
  // Phase 5 TODO: delete the TaskRouter Worker (agent.twilioWorkerSid) once telephony is live.
  await pushPresence(c.env, orgId, { identity: agent.email, status: 'offline', at: Date.now() })
  return c.json({ success: true, data: { id: agent.id } })
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/agents-route.test.ts`
Expected: PASS (existing enable tests + 2 new).

- [ ] **Step 5: Commit**

```bash
git add server/routes/agents.ts test/agents-route.test.ts
git commit -m "feat: DELETE /api/agents/:id — disable an agent (audit + presence drop)"
```

---

### Task 5: Frontend — strategy picker + delete queue

**Files:**
- Create: `src/lib/strategies.ts`
- Modify: `src/pages/Queues.tsx`

**Interfaces:**
- Consumes: `QUEUE_STRATEGY_LABELS`, `QUEUE_STRATEGIES`, `DEFAULT_QUEUE_STRATEGY` (mirrored client-side); `fetchJson`; `Button` (`variant="danger"`, `size="sm"`).
- Produces: Queue create form sends a chosen `strategy`; each queue row has an inline strategy `<select>` (PATCH on change) and a two-step Delete control.

- [ ] **Step 1: Create the client-side strategy mirror**

```ts
// src/lib/strategies.ts
// Mirror of server/lib/queues/strategies.ts — server stays the source of truth for validation.
export const QUEUE_STRATEGIES = ['longest-idle', 'round-robin', 'ring-all', 'priority'] as const
export type QueueStrategy = typeof QUEUE_STRATEGIES[number]
export const DEFAULT_QUEUE_STRATEGY: QueueStrategy = 'longest-idle'
export const QUEUE_STRATEGY_LABELS: Record<QueueStrategy, string> = {
  'longest-idle': 'Longest idle',
  'round-robin': 'Round robin',
  'ring-all': 'Ring all',
  priority: 'Priority order',
}
```

- [ ] **Step 2: Add strategy select to the create form**

In `src/pages/Queues.tsx`: update imports and the create mutation/form so a strategy is chosen and sent.

Add to the top imports:

```tsx
import { QUEUE_STRATEGIES, QUEUE_STRATEGY_LABELS, DEFAULT_QUEUE_STRATEGY, type QueueStrategy } from '../lib/strategies'
```

In `Queues()` add state and change the create mutation to send strategy:

```tsx
  const [name, setName] = useState('')
  const [newStrategy, setNewStrategy] = useState<QueueStrategy>(DEFAULT_QUEUE_STRATEGY)

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; strategy: QueueStrategy }) =>
      fetchJson<Queue>('/api/queues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      setName('')
      setNewStrategy(DEFAULT_QUEUE_STRATEGY)
      queryClient.invalidateQueries({ queryKey: ['queues'] })
    },
  })
```

Update the create form's submit + add the select (replace the `<form>` inner controls):

```tsx
          <form
            className="flex flex-wrap items-center gap-2 px-5 pb-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) createMutation.mutate({ name: name.trim(), strategy: newStrategy })
            }}
          >
            <label className="sr-only" htmlFor="queue-name">Queue name</label>
            <input
              id="queue-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Support"
              className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            />
            <label className="sr-only" htmlFor="queue-strategy">Distribution</label>
            <select
              id="queue-strategy"
              value={newStrategy}
              onChange={(e) => setNewStrategy(e.target.value as QueueStrategy)}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
            >
              {QUEUE_STRATEGIES.map((s) => <option key={s} value={s}>{QUEUE_STRATEGY_LABELS[s]}</option>)}
            </select>
            <Button variant="primary" type="submit" disabled={!name.trim() || createMutation.isPending}>
              Create queue
            </Button>
          </form>
```

- [ ] **Step 3: Add inline strategy edit + delete to `QueueRow`**

`QueueRow` needs the query client. Replace the header block (the `<div className="flex items-center justify-between gap-3">…<Badge>{queue.strategy}</Badge></div>`) with an inline strategy `<select>` and a two-step delete. Add mutations inside `QueueRow`:

```tsx
  const strategyMutation = useMutation({
    mutationFn: (strategy: string) =>
      fetchJson<Queue>(`/api/queues/${queue.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ strategy }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queues'] }),
  })
  const deleteMutation = useMutation({
    mutationFn: () => fetchJson<{ id: string }>(`/api/queues/${queue.id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['queues'] }),
  })
  const [confirming, setConfirming] = useState(false)
```

Then the header JSX:

```tsx
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink">{queue.name}</div>
          <div className="tabular text-xs text-muted">{queue.twilioWorkflowSid}</div>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={`strategy-${queue.id}`}>Distribution for {queue.name}</label>
          <select
            id={`strategy-${queue.id}`}
            value={queue.strategy}
            disabled={strategyMutation.isPending}
            onChange={(e) => strategyMutation.mutate(e.target.value)}
            className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
          >
            {QUEUE_STRATEGIES.map((s) => <option key={s} value={s}>{QUEUE_STRATEGY_LABELS[s]}</option>)}
          </select>
          {confirming ? (
            <span className="flex items-center gap-1.5">
              <span className="text-xs text-muted">Delete “{queue.name}”? Agents unassigned; call history kept.</span>
              <Button size="sm" variant="danger" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate()}>Confirm</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
            </span>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>Delete</Button>
          )}
        </div>
      </div>
```

(`QueueRow` already has `const queryClient = useQueryClient()` and imports `useState`. The strategy value that used to render in a `<Badge>` is now the `<select>`; `Badge` may remain imported for member chips.)

- [ ] **Step 4: Verify build + typecheck**

Run: `npm run build`
Expected: `tsc -b` passes (no type errors) and Vite build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/lib/strategies.ts src/pages/Queues.tsx
git commit -m "feat: queue strategy picker (create + inline edit) and delete-with-confirm UI"
```

---

### Task 6: Frontend — disable agent

**Files:**
- Modify: `src/pages/Agents.tsx`

**Interfaces:**
- Consumes: `fetchJson`; `Button` (`variant="danger"`, `size="sm"`).
- Produces: each enabled-agent row has a two-step Disable control that `DELETE`s the agent and invalidates `['agents']` + `['agents','candidates']`.

- [ ] **Step 1: Add the disable mutation + a per-row control**

In `src/pages/Agents.tsx`, add `useState` to the React import:

```tsx
import { useState } from 'react'
```

Add the mutation inside `Agents()` (after `enableMutation`):

```tsx
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const disableMutation = useMutation({
    mutationFn: (id: string) => fetchJson<{ id: string }>(`/api/agents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmId(null)
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['agents', 'candidates'] })
    },
  })
```

Replace the enabled-agent row (the `<li>` mapping `agentsQuery.data!.map((a) => …)`) trailing `<Badge>` with the badge + a disable control:

```tsx
                <li key={a.id} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                  <div>
                    <div className="text-sm font-medium text-ink">{a.email}</div>
                    <div className="tabular text-xs text-muted">{a.twilioWorkerSid}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={a.status === 'offline' ? 'neutral' : 'accent'}>{a.status}</Badge>
                    {confirmId === a.id ? (
                      <>
                        <span className="text-xs text-muted">Disable {a.email}?</span>
                        <Button size="sm" variant="danger" disabled={disableMutation.isPending} onClick={() => disableMutation.mutate(a.id)}>Confirm</Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
                      </>
                    ) : (
                      <Button size="sm" variant="danger" onClick={() => setConfirmId(a.id)}>Disable</Button>
                    )}
                  </div>
                </li>
```

Add an error line after the enabled-agents `<Card>`-list (mirror the enable error), inside the Agents section `<Card>` before its close:

```tsx
          {disableMutation.isError && <p className="px-5 pb-4 text-sm text-rose-600">{(disableMutation.error as Error).message}</p>}
```

- [ ] **Step 2: Verify build + typecheck**

Run: `npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/pages/Agents.tsx
git commit -m "feat: disable-agent control on the Agents page (two-step confirm)"
```

---

### Task 7: Full verification gate

**Files:** none (verification only).

- [ ] **Step 1: Run the whole unit suite**

Run: `npx vitest run`
Expected: all green (existing suite + new strategy/queue/agent tests). Note: any pre-existing Windows pool-workers skips are unchanged and acceptable.

- [ ] **Step 2: Typecheck server + lint**

Run: `npm run typecheck:server && npm run lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Drive it (verify skill / manual)**

Bring the app up locally (`npm run dev` + `npm run dev:worker` with `DEV_AUTH=true`, mint a dev admin session) and confirm: create a queue with a chosen strategy; change a queue's strategy inline; delete a queue (confirm step); disable an agent and see them return to Candidates. This exercises the real endpoints under dry-run.

- [ ] **Step 5: Commit any doc touch-ups** (if needed)

```bash
git commit --allow-empty -m "chore: queue & agent admin controls — verification gate green"
```

---

## Self-Review

**Spec coverage:**
- A. Strategy enum + validation → Tasks 1, 2 (server), 5 (client mirror). ✅
- B. Delete queue UI + audit → Task 2 (audit), Task 5 (UI). ✅
- C. Strategy control UI (create + inline edit) → Task 5. ✅
- D. Disable agent (accessors, route, UI) → Tasks 3, 4, 6. ✅
- E. Audit consistency (`queue.delete`, `queue.strategy`, `agent.disable`) → Tasks 2, 4. ✅
- Testing (validation 400s, delete cascade/audit, disable cascade/audit/presence, cross-org 404, no-Twilio) → Tasks 1-4, 7. ✅
- Out-of-scope (Phase 5 teardown/routing) → left as commented TODO in Task 4; not implemented. ✅

**Placeholder scan:** No TBD/TODO-as-work; the only "TODO" is the deliberate Phase 5 code comment. All steps carry real code/commands.

**Type consistency:** `QueueStrategy`, `isQueueStrategy`, `DEFAULT_QUEUE_STRATEGY`, `QUEUE_STRATEGY_LABELS`, `getAgentById`, `deleteAgent`, `pushPresence({identity,status,at})`, audit `{ organizationId, userId, action, meta }` all match their defining tasks and the real accessors in the codebase.
