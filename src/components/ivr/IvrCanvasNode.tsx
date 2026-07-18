import { Handle, Position, type NodeProps } from '@xyflow/react'
import { NODE_META, TERMINAL_TYPES } from './nodeMeta'
import { cn } from '../../lib/utils'
import type { IvrNode, IvrNodeType } from '@shared/ivr/graph'

export type IvrCanvasNodeData = { config: IvrNode['config'] }

// One renderer shared by all 9 node types (registered under every type key in
// IvrEditor's `nodeTypes` map) — differentiated by icon/accent/summary from nodeMeta.
export function IvrCanvasNode({ type, data, selected }: NodeProps) {
  const nodeType = type as IvrNodeType
  const meta = NODE_META[nodeType]
  const Icon = meta.icon
  const config = (data as IvrCanvasNodeData).config

  return (
    <div
      className={cn(
        'w-56 rounded-lg border bg-surface px-3 py-2 shadow-[var(--shadow-card)]',
        selected ? 'border-[var(--color-accent)] ring-2 ring-[var(--color-accent-soft)]' : 'border-line',
      )}
    >
      {nodeType !== 'start' && <Handle type="target" position={Position.Top} className="!size-2 !border-none !bg-muted" />}
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', meta.accent)} />
        <div className="truncate text-[13px] font-medium text-ink">{meta.label}</div>
      </div>
      <div className="mt-1 truncate text-xs text-muted">{meta.summary(config as never)}</div>
      {!TERMINAL_TYPES.has(nodeType) && (
        <Handle type="source" position={Position.Bottom} className="!size-2 !border-none !bg-[var(--color-accent)]" />
      )}
    </div>
  )
}
