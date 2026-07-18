import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card, CardHead, Button, Badge, ErrorState, TableSkeleton } from '../components/ui'
import { fetchJson } from '../lib/api'

type OrgSettings = { organizationId: string; recordingEnabled: boolean; announcementText: string | null }

export default function Settings() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: () => fetchJson<OrgSettings>('/api/settings') })

  const [wording, setWording] = useState('')
  useEffect(() => {
    if (settingsQuery.data) setWording(settingsQuery.data.announcementText ?? '')
  }, [settingsQuery.data])

  const patchMutation = useMutation({
    mutationFn: (patch: { recordingEnabled?: boolean; announcementText?: string | null }) =>
      fetchJson<OrgSettings>('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  })

  if (settingsQuery.isLoading) {
    return (
      <Card>
        <CardHead title="Call recording" />
        <TableSkeleton rows={3} />
      </Card>
    )
  }
  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <Card>
        <CardHead title="Call recording" />
        <ErrorState label="Couldn't load settings." onRetry={() => settingsQuery.refetch()} />
      </Card>
    )
  }

  const s = settingsQuery.data
  return (
    <div className="max-w-2xl space-y-6">
      <section aria-label="Call recording">
        <Card>
          <CardHead
            title="Call recording"
            hint="Applies to every inbound call in this organization"
            right={<Badge tone={s.recordingEnabled ? 'accent' : 'neutral'}>{s.recordingEnabled ? 'Recording on' : 'Recording off'}</Badge>}
          />
          <div className="space-y-4 px-5 pb-5">
            {/* The consent invariant (Steven, 2026-07-16): the announcement is a property of
                recording, not a second choice. This copy must never suggest silent recording. */}
            <p className="text-sm text-muted">
              Turning recording on <span className="font-medium text-ink">also turns on the caller announcement</span> —
              every caller hears it before joining a queue. The announcement cannot be switched off
              separately: silent recording is not available.
            </p>
            <Button
              variant={s.recordingEnabled ? 'danger' : 'primary'}
              disabled={patchMutation.isPending}
              onClick={() => patchMutation.mutate({ recordingEnabled: !s.recordingEnabled })}
            >
              {s.recordingEnabled ? 'Turn recording off' : 'Turn recording on'}
            </Button>
          </div>
        </Card>
      </section>

      <section aria-label="Announcement wording">
        <Card>
          <CardHead
            title="Announcement wording"
            hint="Played to callers while recording is on; leave blank to use the default wording"
          />
          <form
            className="flex items-center gap-2 px-5 pb-5"
            onSubmit={(e) => {
              e.preventDefault()
              patchMutation.mutate({ announcementText: wording.trim() === '' ? null : wording.trim() })
            }}
          >
            <label className="sr-only" htmlFor="announcement-text">
              Announcement wording
            </label>
            <input
              id="announcement-text"
              value={wording}
              onChange={(e) => setWording(e.target.value)}
              placeholder="This call may be recorded for quality and training purposes."
              className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
            />
            <Button type="submit" disabled={patchMutation.isPending}>
              Save wording
            </Button>
          </form>
          {patchMutation.isError && (
            <p className="px-5 pb-4 text-sm text-rose-600">{(patchMutation.error as Error).message}</p>
          )}
        </Card>
      </section>
    </div>
  )
}
