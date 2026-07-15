import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardHead, Button, Badge, EmptyState, TableSkeleton, ErrorState } from '../components/ui'
import { fetchJson } from '../lib/api'

type Agent = {
  id: string
  organizationId: string
  userId: string | null
  email: string
  workspaceResourceId: string | null
  twilioWorkerSid: string | null
  status: string
  activitySid: string | null
}

type Candidate = { id: string; name: string; email: string; jobRole: string | null }

export default function Agents() {
  const queryClient = useQueryClient()

  const agentsQuery = useQuery({ queryKey: ['agents'], queryFn: () => fetchJson<Agent[]>('/api/agents') })
  const candidatesQuery = useQuery({
    queryKey: ['agents', 'candidates'],
    queryFn: () => fetchJson<Candidate[]>('/api/agents/candidates'),
  })

  const enableMutation = useMutation({
    mutationFn: (email: string) =>
      fetchJson<Agent>('/api/agents/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] })
      queryClient.invalidateQueries({ queryKey: ['agents', 'candidates'] })
    },
  })

  return (
    <div className="space-y-6">
      <section aria-label="Agents">
        <Card>
          <CardHead title="Agents" hint="Enabled Clarion agents in this org" />
          {agentsQuery.isLoading ? (
            <TableSkeleton />
          ) : agentsQuery.isError ? (
            <ErrorState label="Couldn't load agents." onRetry={() => agentsQuery.refetch()} />
          ) : agentsQuery.data!.length === 0 ? (
            <EmptyState title="No agents yet" hint="Enable a Workspace teammate below to get started." />
          ) : (
            <ul className="space-y-1 px-5 pb-4">
              {agentsQuery.data!.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                  <div>
                    <div className="text-sm font-medium text-ink">{a.email}</div>
                    <div className="tabular text-xs text-muted">{a.twilioWorkerSid}</div>
                  </div>
                  <Badge tone={a.status === 'offline' ? 'neutral' : 'accent'}>{a.status}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section aria-label="Candidates">
        <Card>
          <CardHead title="Candidates" hint="Workspace teammates not yet enabled as agents" />
          {candidatesQuery.isLoading ? (
            <TableSkeleton />
          ) : candidatesQuery.isError ? (
            <ErrorState label="Couldn't load candidates." onRetry={() => candidatesQuery.refetch()} />
          ) : candidatesQuery.data!.length === 0 ? (
            <EmptyState title="No candidates" hint="Every Workspace teammate in this org is already enabled." />
          ) : (
            <ul className="space-y-1 px-5 pb-4">
              {candidatesQuery.data!.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                  <div>
                    <div className="text-sm font-medium text-ink">{r.name}</div>
                    <div className="text-xs text-muted">
                      {r.email}
                      {r.jobRole ? ` · ${r.jobRole}` : ''}
                    </div>
                  </div>
                  <Button size="sm" variant="primary" disabled={enableMutation.isPending} onClick={() => enableMutation.mutate(r.email)}>
                    Enable
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {enableMutation.isError && <p className="px-5 pb-4 text-sm text-rose-600">{(enableMutation.error as Error).message}</p>}
        </Card>
      </section>
    </div>
  )
}
