import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardHead, Button, Badge, EmptyState, TableSkeleton, ErrorState } from '../components/ui'
import { fetchJson } from '../lib/api'

type IvrFlow = { id: string; organizationId: string; name: string; status: 'draft' | 'active'; definition: unknown; updatedAt: number }

export default function IvrFlows() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')

  const flowsQuery = useQuery({ queryKey: ['ivr-flows'], queryFn: () => fetchJson<IvrFlow[]>('/api/ivr/flows') })

  const createMutation = useMutation({
    mutationFn: (flowName: string) =>
      fetchJson<IvrFlow>('/api/ivr/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: flowName }),
      }),
    onSuccess: () => {
      setName('')
      queryClient.invalidateQueries({ queryKey: ['ivr-flows'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetchJson<{ id: string }>(`/api/ivr/flows/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ivr-flows'] }),
  })

  return (
    <div className="space-y-6">
      <section aria-label="IVR flows">
        <Card>
          <CardHead
            title="IVR flows"
            hint="Call flows built with the visual editor — attaching one to a live number is a later phase"
          />
          {flowsQuery.isLoading ? (
            <TableSkeleton />
          ) : flowsQuery.isError ? (
            <ErrorState label="Couldn't load flows." onRetry={() => flowsQuery.refetch()} />
          ) : flowsQuery.data!.length === 0 ? (
            <EmptyState title="No flows yet" hint="Create one below to start building in the editor." />
          ) : (
            <ul className="space-y-1 px-5 pb-4">
              {flowsQuery.data!.map((flow) => (
                <li key={flow.id} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                  <Link to={`/ivr/${flow.id}`} className="min-w-0 hover:underline">
                    <div className="truncate text-sm font-medium text-ink">{flow.name}</div>
                    <div className="tabular text-xs text-muted">Updated {new Date(flow.updatedAt).toLocaleString()}</div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone={flow.status === 'active' ? 'accent' : 'neutral'}>{flow.status}</Badge>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={deleteMutation.isPending}
                      onClick={() => deleteMutation.mutate(flow.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-label="Create IVR flow">
        <Card>
          <CardHead title="Create flow" hint="Starts as a single Start node — build it out in the editor" />
          <form
            className="flex items-center gap-2 px-5 pb-5"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) createMutation.mutate(name.trim())
            }}
          >
            <label className="sr-only" htmlFor="flow-name">
              Flow name
            </label>
            <input
              id="flow-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main IVR"
              className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            />
            <Button variant="primary" type="submit" disabled={!name.trim() || createMutation.isPending}>
              Create flow
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
