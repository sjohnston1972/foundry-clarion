import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardHead, Button, Badge, EmptyState, TableSkeleton, ErrorState } from '../components/ui'
import { fetchJson } from '../lib/api'
import { QUEUE_STRATEGIES, QUEUE_STRATEGY_LABELS, DEFAULT_QUEUE_STRATEGY, type QueueStrategy } from '../lib/strategies'

type Queue = { id: string; organizationId: string; name: string; twilioWorkflowSid: string | null; strategy: string }
type QueueMember = { queueId: string; agentId: string; priority: number }
type Agent = { id: string; email: string; status: string }

function QueueRow({ queue, agents }: { queue: Queue; agents: Agent[] }) {
  const queryClient = useQueryClient()
  const [agentId, setAgentId] = useState('')

  const membersQuery = useQuery({
    queryKey: ['queues', queue.id, 'members'],
    queryFn: () => fetchJson<QueueMember[]>(`/api/queues/${queue.id}/members`),
  })

  const assignMutation = useMutation({
    mutationFn: (id: string) =>
      fetchJson<QueueMember>(`/api/queues/${queue.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: id, priority: 0 }),
      }),
    onSuccess: () => {
      setAgentId('')
      queryClient.invalidateQueries({ queryKey: ['queues', queue.id, 'members'] })
    },
  })

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

  const emailOf = (id: string) => agents.find((a) => a.id === id)?.email ?? id
  const members = membersQuery.data ?? []
  const unassigned = agents.filter((a) => !members.some((m) => m.agentId === a.id))
  const selectId = `assign-${queue.id}`

  return (
    <li className="border-t border-line py-4 first:border-t-0">
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

      <div className="mt-3">
        <div className="text-[11px] font-medium uppercase tracking-wide text-faint">Members</div>
        {membersQuery.isError ? (
          <p className="mt-1 text-xs text-muted">Couldn't load members.</p>
        ) : members.length === 0 ? (
          <p className="mt-1 text-xs text-muted">No agents assigned.</p>
        ) : (
          <ul aria-label={`Members of ${queue.name}`} className="mt-1 flex flex-wrap gap-1.5">
            {members.map((m) => (
              <li key={m.agentId}>
                <Badge tone="accent">{emailOf(m.agentId)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <label className="sr-only" htmlFor={selectId}>
          Assign agent to {queue.name}
        </label>
        <select
          id={selectId}
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
        >
          <option value="">Choose an agent…</option>
          {unassigned.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
        <Button size="sm" disabled={!agentId || assignMutation.isPending} onClick={() => assignMutation.mutate(agentId)}>
          Assign
        </Button>
      </div>
    </li>
  )
}

export default function Queues() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [newStrategy, setNewStrategy] = useState<QueueStrategy>(DEFAULT_QUEUE_STRATEGY)

  const queuesQuery = useQuery({ queryKey: ['queues'], queryFn: () => fetchJson<Queue[]>('/api/queues') })
  const agentsQuery = useQuery({ queryKey: ['agents'], queryFn: () => fetchJson<Agent[]>('/api/agents') })

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

  return (
    <div className="space-y-6">
      <section aria-label="Queues">
        <Card>
          <CardHead title="Queues" hint="TaskRouter Workflows for this org — dry-run SIDs are expected while TWILIO_DRY_RUN is on" />
          {queuesQuery.isLoading ? (
            <TableSkeleton />
          ) : queuesQuery.isError ? (
            <ErrorState label="Couldn't load queues." onRetry={() => queuesQuery.refetch()} />
          ) : queuesQuery.data!.length === 0 ? (
            <EmptyState title="No queues yet" hint="Create one below — its Workflow is provisioned dry-run." />
          ) : (
            <ul className="space-y-1 px-5 pb-4">
              {queuesQuery.data!.map((q) => (
                <QueueRow key={q.id} queue={q} agents={agentsQuery.data ?? []} />
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-label="Create queue">
        <Card>
          <CardHead title="Create queue" hint="Provisions a TaskRouter Workflow (dry-run under TWILIO_DRY_RUN)" />
          <form
            className="flex flex-wrap items-center gap-2 px-5 pb-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) createMutation.mutate({ name: name.trim(), strategy: newStrategy })
            }}
          >
            <label className="sr-only" htmlFor="queue-name">
              Queue name
            </label>
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
          {createMutation.isError && (
            <p className="px-5 pb-4 text-sm text-rose-600">{(createMutation.error as Error).message}</p>
          )}
        </Card>
      </section>
    </div>
  )
}
