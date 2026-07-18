import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHead, Stat, Badge, Button, Spinner, EmptyState, TableSkeleton, ErrorState } from '../components/ui'
import { fetchJson } from '../lib/api'
import { cn } from '../lib/utils'

type Call = {
  id: string
  twilioCallSid: string
  fromE164: string
  toE164: string
  queueId: string | null
  agentId: string | null
  disposition: string | null
  durationS: number | null
}
type CallSummary = { total: number; answered: number; abandoned: number; avgDurationS: number }
type Queue = { id: string; name: string }
type Agent = { id: string; email: string }
type Recording = {
  id: string
  twilioRecordingSid: string
  durationS: number | null
  transcriptStatus: 'pending' | 'done' | 'failed' | 'skipped'
}
type Transcript = { text: string; model: string; dryRun: boolean }

function TranscriptPanel({ rec }: { rec: Recording }) {
  const transcriptQuery = useQuery({
    queryKey: ['transcript', rec.id],
    enabled: rec.transcriptStatus === 'done',
    queryFn: async () => {
      // The transcript endpoint streams the R2 JSON directly — no { success, data } envelope.
      const res = await fetch(`/api/recordings/${rec.id}/transcript`, { credentials: 'include', cache: 'no-store' })
      if (!res.ok) throw new Error(`transcript ${res.status}`)
      return (await res.json()) as Transcript
    },
  })

  // pending/failed render distinctly — a silent blank is how a missing transcript
  // becomes invisible (plan Step 12).
  if (rec.transcriptStatus === 'pending') {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted">
        <Spinner /> Transcribing…
      </div>
    )
  }
  if (rec.transcriptStatus === 'failed' || rec.transcriptStatus === 'skipped') {
    return <ErrorState label="Transcription failed for this recording. The audio above is unaffected." />
  }
  if (transcriptQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-muted">
        <Spinner /> Loading transcript…
      </div>
    )
  }
  if (transcriptQuery.isError) {
    return <ErrorState label="Couldn't load the transcript." onRetry={() => transcriptQuery.refetch()} />
  }
  return <p className="py-2 text-sm text-ink-2">{transcriptQuery.data!.text}</p>
}

function CallDetails({ call }: { call: Call }) {
  const recordingsQuery = useQuery({
    queryKey: ['recordings', call.id],
    queryFn: () => fetchJson<Recording[]>(`/api/recordings?callId=${call.id}`),
  })

  return (
    <Card>
      <CardHead title="Call detail" hint={<span className="tabular">{call.twilioCallSid}</span>} />
      <div className="space-y-4 px-5 pb-5">
        {recordingsQuery.isLoading ? (
          <TableSkeleton rows={2} />
        ) : recordingsQuery.isError ? (
          <ErrorState label="Couldn't load recordings." onRetry={() => recordingsQuery.refetch()} />
        ) : recordingsQuery.data!.length === 0 ? (
          <EmptyState title="No recording" hint="Recording was off for this call, or it hasn't arrived yet." />
        ) : (
          recordingsQuery.data!.map((rec) => (
            <div key={rec.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="tabular text-xs text-muted">{rec.twilioRecordingSid}</span>
                <Badge tone={rec.transcriptStatus === 'done' ? 'accent' : 'neutral'}>{rec.transcriptStatus}</Badge>
              </div>
              <audio controls preload="none" className="w-full" src={`/api/recordings/${rec.id}/media`} />
              <TranscriptPanel rec={rec} />
            </div>
          ))
        )}
      </div>
    </Card>
  )
}

const inputCls = 'h-8 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink'

export default function Reports() {
  const [filters, setFilters] = useState({ from: '', to: '', queueId: '', agentId: '', disposition: '' })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v !== '')).toString()
  const reportQuery = useQuery({
    queryKey: ['reports', qs],
    queryFn: () => fetchJson<{ calls: Call[]; summary: CallSummary }>(`/api/reports/calls${qs ? `?${qs}` : ''}`),
  })
  const queuesQuery = useQuery({ queryKey: ['queues'], queryFn: () => fetchJson<Queue[]>('/api/queues') })
  const agentsQuery = useQuery({ queryKey: ['agents'], queryFn: () => fetchJson<Agent[]>('/api/agents') })

  const summary = reportQuery.data?.summary
  const calls = reportQuery.data?.calls ?? []
  const selected = calls.find((c) => c.id === selectedId) ?? null
  const set = (k: keyof typeof filters) => (v: string) => setFilters((f) => ({ ...f, [k]: v }))

  return (
    <div className="space-y-6">
      <section aria-label="Call summary">
        <Card>
          <CardHead title="Reports" hint="Calls in this organization, filtered below" />
          <div className="grid grid-cols-2 gap-6 px-5 pb-5 sm:grid-cols-4">
            <Stat label="Total calls" value={summary?.total ?? '—'} accent />
            <Stat label="Answered" value={summary?.answered ?? '—'} />
            <Stat label="Abandoned" value={summary?.abandoned ?? '—'} />
            <Stat label="Avg duration" value={summary ? `${summary.avgDurationS}s` : '—'} />
          </div>
        </Card>
      </section>

      <section aria-label="Calls">
        <Card>
          <CardHead title="Calls" hint="Newest first; select a row for its recording and transcript" />
          <div className="flex flex-wrap items-center gap-2 px-5 pb-3">
            <label className="sr-only" htmlFor="flt-from">From</label>
            <input id="flt-from" type="datetime-local" className={inputCls} value={filters.from} onChange={(e) => set('from')(e.target.value)} />
            <label className="sr-only" htmlFor="flt-to">To</label>
            <input id="flt-to" type="datetime-local" className={inputCls} value={filters.to} onChange={(e) => set('to')(e.target.value)} />
            <label className="sr-only" htmlFor="flt-queue">Queue</label>
            <select id="flt-queue" className={inputCls} value={filters.queueId} onChange={(e) => set('queueId')(e.target.value)}>
              <option value="">All queues</option>
              {(queuesQuery.data ?? []).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
            </select>
            <label className="sr-only" htmlFor="flt-agent">Agent</label>
            <select id="flt-agent" className={inputCls} value={filters.agentId} onChange={(e) => set('agentId')(e.target.value)}>
              <option value="">All agents</option>
              {(agentsQuery.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
            </select>
            <label className="sr-only" htmlFor="flt-disposition">Disposition</label>
            <select id="flt-disposition" className={inputCls} value={filters.disposition} onChange={(e) => set('disposition')(e.target.value)}>
              <option value="">All dispositions</option>
              {['completed', 'no-answer', 'busy', 'failed', 'in-progress'].map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            {qs !== '' && (
              <Button size="sm" variant="ghost" onClick={() => setFilters({ from: '', to: '', queueId: '', agentId: '', disposition: '' })}>
                Clear filters
              </Button>
            )}
          </div>
          {reportQuery.isLoading ? (
            <TableSkeleton />
          ) : reportQuery.isError ? (
            <ErrorState label="Couldn't load calls." onRetry={() => reportQuery.refetch()} />
          ) : calls.length === 0 ? (
            <EmptyState title="No calls match" hint="Loosen the filters, or wait for calls to arrive." />
          ) : (
            <ul className="px-5 pb-4">
              {calls.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id === selectedId ? null : c.id)}
                    className={cn(
                      'flex w-full items-center justify-between gap-3 border-t border-line py-2.5 text-left first:border-t-0 hover:bg-canvas',
                      c.id === selectedId && 'bg-[var(--color-accent-soft)]',
                    )}
                  >
                    <span className="tabular text-xs text-muted">{c.twilioCallSid}</span>
                    <span className="text-sm text-ink">{c.fromE164} → {c.toE164}</span>
                    <span className="tabular text-xs text-muted">{c.durationS != null ? `${c.durationS}s` : '—'}</span>
                    <Badge tone={c.agentId ? 'accent' : 'neutral'}>{c.disposition ?? 'unknown'}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {selected && (
        <section aria-label="Call detail">
          <CallDetails call={selected} />
        </section>
      )}
    </div>
  )
}
