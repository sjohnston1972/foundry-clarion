import type { Node, Edge } from '@xyflow/react'
import { Button } from '../ui'
import { NODE_META } from './nodeMeta'
import type { IvrCanvasNodeData } from './IvrCanvasNode'
import type { IfOp, IvrNode, IvrNodeType, WeeklyHours } from '@shared/ivr/graph'

type Queue = { id: string; name: string }

export type Selection = { kind: 'node'; node: Node } | { kind: 'edge'; edge: Edge } | null

type Props = {
  selection: Selection
  queues: Queue[]
  onUpdateNodeConfig: (nodeId: string, config: IvrNode['config']) => void
  onUpdateEdgeBranch: (edgeId: string, branch: string) => void
  onDeleteSelection: () => void
}

const fieldClass = 'mt-1 h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink'
const labelClass = 'text-[11px] font-medium uppercase tracking-wide text-faint'

function NodeFields({ type, config, onChange, queues }: { type: IvrNodeType; config: IvrNode['config']; onChange: (patch: Record<string, unknown>) => void; queues: Queue[] }) {
  switch (type) {
    case 'start':
    case 'hangup':
      return <p className="text-sm text-muted">No configuration for this node.</p>

    case 'play': {
      const c = config as { say: string }
      return (
        <label className="block">
          <span className={labelClass}>Say</span>
          <textarea className={`${fieldClass} h-24 resize-none py-2`} value={c.say} onChange={(e) => onChange({ say: e.target.value })} />
        </label>
      )
    }

    case 'menu': {
      const c = config as { prompt: string; timeoutSeconds: number }
      return (
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Prompt</span>
            <textarea className={`${fieldClass} h-24 resize-none py-2`} value={c.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelClass}>Timeout (seconds)</span>
            <input type="number" min={1} className={fieldClass} value={c.timeoutSeconds}
              onChange={(e) => onChange({ timeoutSeconds: Number(e.target.value) })} />
          </label>
        </div>
      )
    }

    case 'collect': {
      const c = config as { prompt: string; numDigits: number; variable: string }
      return (
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Prompt</span>
            <textarea className={`${fieldClass} h-24 resize-none py-2`} value={c.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelClass}>Digits to collect</span>
            <input type="number" min={1} className={fieldClass} value={c.numDigits}
              onChange={(e) => onChange({ numDigits: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className={labelClass}>Store as variable</span>
            <input className={fieldClass} value={c.variable} onChange={(e) => onChange({ variable: e.target.value })} />
          </label>
        </div>
      )
    }

    case 'if': {
      const c = config as { left: string; op: IfOp; right: string }
      return (
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Left (use $variable)</span>
            <input className={fieldClass} value={c.left} onChange={(e) => onChange({ left: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelClass}>Operator</span>
            <select className={fieldClass} value={c.op} onChange={(e) => onChange({ op: e.target.value as IfOp })}>
              {(['eq', 'neq', 'gt', 'lt', 'gte', 'lte'] satisfies IfOp[]).map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Right</span>
            <input className={fieldClass} value={c.right} onChange={(e) => onChange({ right: e.target.value })} />
          </label>
        </div>
      )
    }

    case 'businessHours': {
      const c = config as { timezone: string; weekly: WeeklyHours[] }
      const updateRow = (i: number, patch: Partial<WeeklyHours>) => {
        const weekly = c.weekly.map((w, idx) => (idx === i ? { ...w, ...patch } : w))
        onChange({ weekly })
      }
      return (
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Timezone (IANA)</span>
            <input className={fieldClass} value={c.timezone} onChange={(e) => onChange({ timezone: e.target.value })} placeholder="e.g. Europe/London" />
          </label>
          <div>
            <span className={labelClass}>Weekly hours</span>
            <div className="mt-1 space-y-2">
              {c.weekly.map((w, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <select className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink" value={w.day}
                    onChange={(e) => updateRow(i, { day: Number(e.target.value) })}>
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, day) => (
                      <option key={day} value={day}>{d}</option>
                    ))}
                  </select>
                  <input type="time" className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-xs text-ink" value={w.open}
                    onChange={(e) => updateRow(i, { open: e.target.value })} />
                  <span className="text-xs text-muted">to</span>
                  <input type="time" className="h-8 w-24 rounded-lg border border-line bg-surface px-2 text-xs text-ink" value={w.close}
                    onChange={(e) => updateRow(i, { close: e.target.value })} />
                  <button type="button" className="text-xs text-rose-600 hover:underline"
                    onClick={() => onChange({ weekly: c.weekly.filter((_, idx) => idx !== i) })}>
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" className="text-xs font-medium text-[var(--color-accent)] hover:underline"
                onClick={() => onChange({ weekly: [...c.weekly, { day: 1, open: '09:00', close: '17:00' }] })}>
                + Add hours
              </button>
            </div>
          </div>
        </div>
      )
    }

    case 'routeToQueue': {
      const c = config as { queueId: string }
      return (
        <label className="block">
          <span className={labelClass}>Queue</span>
          <select className={fieldClass} value={c.queueId} onChange={(e) => onChange({ queueId: e.target.value })}>
            <option value="">Choose a queue…</option>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        </label>
      )
    }

    case 'voicemail': {
      const c = config as { prompt: string; maxLengthSeconds: number }
      return (
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Prompt</span>
            <textarea className={`${fieldClass} h-24 resize-none py-2`} value={c.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelClass}>Max length (seconds)</span>
            <input type="number" min={1} className={fieldClass} value={c.maxLengthSeconds}
              onChange={(e) => onChange({ maxLengthSeconds: Number(e.target.value) })} />
          </label>
        </div>
      )
    }
  }
}

export function ConfigPanel({ selection, queues, onUpdateNodeConfig, onUpdateEdgeBranch, onDeleteSelection }: Props) {
  if (!selection) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">
        Select a node or a connection to edit it.
      </div>
    )
  }

  if (selection.kind === 'edge') {
    const branch = (selection.edge.data as { branch?: string } | undefined)?.branch ?? 'next'
    // IvrEditor computes this from the source node's type (see branchOptionsFor) whenever
    // it builds/updates edges, so the panel doesn't need to look up the source node itself.
    const options = (selection.edge.data as { branchOptions?: string[] } | undefined)?.branchOptions ?? null
    return (
      <div className="flex h-full flex-col p-4">
        <div className={labelClass}>Connection</div>
        <div className="mt-1 text-sm text-ink">{selection.edge.source} → {selection.edge.target}</div>
        <div className="mt-4">
          <span className={labelClass}>Branch</span>
          {options ? (
            <select className={fieldClass} value={branch} onChange={(e) => onUpdateEdgeBranch(selection.edge.id, e.target.value)}>
              {options.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          ) : (
            <p className="mt-1 text-sm text-muted">next (fixed — this node type has a single outgoing path)</p>
          )}
        </div>
        <div className="mt-auto pt-4">
          <Button variant="danger" size="sm" onClick={onDeleteSelection}>Delete connection</Button>
        </div>
      </div>
    )
  }

  const node = selection.node
  const nodeType = node.type as IvrNodeType
  const meta = NODE_META[nodeType]
  const config = (node.data as IvrCanvasNodeData).config

  return (
    <div className="flex h-full flex-col p-4">
      <div className={labelClass}>{meta.label}</div>
      <div className="mt-1 mb-4 font-mono text-xs text-muted">{node.id}</div>
      <NodeFields
        type={nodeType}
        config={config}
        queues={queues}
        // NodeFields' switch only ever sends patches matching this node's own config shape
        // (keyed on the same `type`), so the merge is safe even though the union can't
        // be proven statically from a generic patch object.
        onChange={(patch) => onUpdateNodeConfig(node.id, { ...config, ...patch } as IvrNode['config'])}
      />
      {nodeType !== 'start' && (
        <div className="mt-auto pt-4">
          <Button variant="danger" size="sm" onClick={onDeleteSelection}>Delete node</Button>
        </div>
      )}
    </div>
  )
}
