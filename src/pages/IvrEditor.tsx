import { useCallback, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ReactFlow, ReactFlowProvider, Background, Controls, addEdge, applyNodeChanges, applyEdgeChanges,
  type Node, type Edge, type Connection, type NodeChange, type EdgeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button, Badge, Loader, ErrorState } from '../components/ui'
import { IvrCanvasNode, type IvrCanvasNodeData } from '../components/ivr/IvrCanvasNode'
import { ConfigPanel, type Selection } from '../components/ivr/ConfigPanel'
import { SimulatorPanel } from '../components/ivr/SimulatorPanel'
import { NODE_META, NODE_TYPES, branchOptionsFor } from '../components/ivr/nodeMeta'
import { fetchJson } from '../lib/api'
import { validateFlow } from '../lib/ivr/validate'
import type { IvrFlowDefinition, IvrNode, IvrNodeType } from '@shared/ivr/graph'

type IvrFlow = { id: string; name: string; status: 'draft' | 'active'; definition: IvrFlowDefinition; updatedAt: number }
type Queue = { id: string; name: string }

// Shared across renders — ReactFlow warns (and re-renders unnecessarily) if nodeTypes
// is a fresh object every render.
const nodeTypes = Object.fromEntries(NODE_TYPES.map((t) => [t, IvrCanvasNode]))

function toFlowNodes(nodes: IvrNode[]): Node[] {
  return nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: { config: n.config } satisfies IvrCanvasNodeData }))
}

function edgeId(source: string, branch: string, target: string): string {
  return `${source}::${branch}::${target}`
}

function toFlowEdges(edges: IvrFlowDefinition['edges'], nodes: IvrNode[]): Edge[] {
  const typeOf = new Map(nodes.map((n) => [n.id, n.type]))
  return edges.map((e) => ({
    id: edgeId(e.source, e.branch, e.target),
    source: e.source,
    target: e.target,
    label: e.branch,
    data: { branch: e.branch, branchOptions: branchOptionsFor(typeOf.get(e.source) as IvrNodeType) },
  }))
}

function fromFlow(nodes: Node[], edges: Edge[]): IvrFlowDefinition {
  const start = nodes.find((n) => n.type === 'start')
  return {
    entryNodeId: start?.id ?? '',
    nodes: nodes.map((n) => ({
      id: n.id, type: n.type as IvrNodeType, position: n.position, config: (n.data as IvrCanvasNodeData).config,
    })) as IvrNode[],
    edges: edges.map((e) => ({
      source: e.source, target: e.target, branch: (e.data as { branch?: string } | undefined)?.branch ?? 'next',
    })),
  }
}

function IvrEditorCanvas({ flow, queues }: { flow: IvrFlow; queues: Queue[] }) {
  const queryClient = useQueryClient()
  const [nodes, setNodes] = useState<Node[]>(() => toFlowNodes(flow.definition.nodes))
  const [edges, setEdges] = useState<Edge[]>(() => toFlowEdges(flow.definition.edges, flow.definition.nodes))
  const [selection, setSelection] = useState<Selection>(null)
  const [rightTab, setRightTab] = useState<'inspector' | 'test'>('inspector')
  const [highlightedNodeIds, setHighlightedNodeIds] = useState<Set<string>>(new Set())
  const [highlightedEdgeIds, setHighlightedEdgeIds] = useState<Set<string>>(new Set())

  const hasStart = nodes.some((n) => n.type === 'start')

  // Live client-side validation — mirrors server/lib/ivr/validate.ts (see
  // src/lib/ivr/validate.ts). Recomputed on every node/edge/queues change; Save is
  // blocked while invalid so the server-side re-validation on PUT should never fire.
  const validation = useMemo(
    () => validateFlow(fromFlow(nodes, edges), { queueIds: queues.map((q) => q.id) }),
    [nodes, edges, queues],
  )

  const saveMutation = useMutation({
    mutationFn: () =>
      fetchJson<IvrFlow>(`/api/ivr/flows/${flow.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ definition: fromFlow(nodes, edges) }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ivr-flows'] }),
  })

  const onNodesChange = useCallback((changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)), [])
  const onEdgesChange = useCallback((changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)), [])

  const onConnect = useCallback(
    (connection: Connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source)
      const options = sourceNode ? branchOptionsFor(sourceNode.type as IvrNodeType) : null
      const branch = options ? options[0] : 'next'
      setEdges((eds) =>
        addEdge({ ...connection, id: edgeId(connection.source!, branch, connection.target!), label: branch, data: { branch, branchOptions: options } }, eds),
      )
    },
    [nodes],
  )

  const addNode = (type: IvrNodeType) => {
    const id = `n_${crypto.randomUUID().slice(0, 8)}`
    const i = nodes.length
    const position = { x: 40 + (i % 4) * 240, y: 40 + Math.floor(i / 4) * 160 }
    setNodes((nds) => [...nds, { id, type, position, data: { config: NODE_META[type].defaultConfig } satisfies IvrCanvasNodeData }])
  }

  const deleteSelection = () => {
    if (!selection) return
    if (selection.kind === 'node') {
      setNodes((nds) => nds.filter((n) => n.id !== selection.node.id))
      setEdges((eds) => eds.filter((e) => e.source !== selection.node.id && e.target !== selection.node.id))
    } else {
      setEdges((eds) => eds.filter((e) => e.id !== selection.edge.id))
    }
    setSelection(null)
  }

  const updateNodeConfig = (nodeId: string, config: IvrNode['config']) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { config } satisfies IvrCanvasNodeData } : n)))
  }

  const updateEdgeBranch = (id: string, branch: string) => {
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, label: branch, data: { ...e.data, branch } } : e)))
  }

  // Selected elements carry a live reference from `nodes`/`edges` state, so the panel
  // always reflects the latest edits even as selection itself doesn't change.
  const liveSelection: Selection = useMemo(() => {
    if (!selection) return null
    if (selection.kind === 'node') {
      const node = nodes.find((n) => n.id === selection.node.id)
      return node ? { kind: 'node', node } : null
    }
    const edge = edges.find((e) => e.id === selection.edge.id)
    return edge ? { kind: 'edge', edge } : null
  }, [selection, nodes, edges])

  // The simulator walks whatever is currently on the canvas, not the last-saved copy —
  // so testing a flow doesn't require saving it first.
  const currentDefinition = useMemo(() => fromFlow(nodes, edges), [nodes, edges])

  // Rendered separately from `nodes`/`edges` (the edit source of truth) so the simulator's
  // path highlight is pure presentation — style/className on the Node/Edge objects is
  // applied by ReactFlow to its own wrapper elements, no custom node/edge code needed.
  const displayNodes = useMemo(
    () => nodes.map((n) => (highlightedNodeIds.has(n.id) ? { ...n, style: { ...n.style, outline: '2px solid var(--color-accent)', outlineOffset: 2 } } : n)),
    [nodes, highlightedNodeIds],
  )
  const displayEdges = useMemo(
    () => edges.map((e) => (highlightedEdgeIds.has(e.id) ? { ...e, animated: true, style: { ...e.style, stroke: 'var(--color-accent)', strokeWidth: 2 } } : e)),
    [edges, highlightedEdgeIds],
  )

  const clearHighlights = () => {
    setHighlightedNodeIds(new Set())
    setHighlightedEdgeIds(new Set())
  }

  return (
    <div className="relative flex h-[calc(100vh-8rem)] gap-4">
      <aside className="w-48 shrink-0 space-y-1 overflow-y-auto rounded-[var(--radius-card)] border border-line bg-surface p-3">
        <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-faint">Add node</div>
        {NODE_TYPES.map((type) => {
          const meta = NODE_META[type]
          const Icon = meta.icon
          const disabled = type === 'start' && hasStart
          return (
            <button
              key={type}
              type="button"
              disabled={disabled}
              onClick={() => addNode(type)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-2 hover:bg-canvas disabled:opacity-40 disabled:pointer-events-none"
            >
              <Icon className={`size-4 ${meta.accent}`} />
              {meta.label}
            </button>
          )
        })}
      </aside>

      <div className="relative flex-1 overflow-hidden rounded-[var(--radius-card)] border border-line bg-canvas">
        <ReactFlow
          nodes={displayNodes}
          edges={displayEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => setSelection({ kind: 'node', node })}
          onEdgeClick={(_, edge) => setSelection({ kind: 'edge', edge })}
          onPaneClick={() => setSelection(null)}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>

        {/* Floating Save + live-validation cluster. Anchored inside the canvas column (not
            the whole row) so the banner never overlaps the Inspector/Test panel to its right. */}
        <div className="pointer-events-none absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
          {!validation.valid && (
            <div className="pointer-events-auto max-w-sm rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 shadow-sm">
              <div className="font-medium">
                {validation.errors.length} issue{validation.errors.length === 1 ? '' : 's'} to fix before saving
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {validation.errors.map((message, i) => (
                  <li key={i}>{message}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="pointer-events-auto flex items-center gap-2">
            {saveMutation.isError && <p className="text-sm text-rose-600">{(saveMutation.error as Error).message}</p>}
            {saveMutation.isSuccess && <span className="text-sm text-emerald-600">Saved</span>}
            <Button variant="primary" disabled={!validation.valid || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              Save
            </Button>
          </div>
        </div>
      </div>

      <aside className="flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] border border-line bg-surface">
        <div className="flex border-b border-line px-2 pt-2">
          {(['inspector', 'test'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => {
                setRightTab(tab)
                if (tab === 'inspector') clearHighlights()
              }}
              className={`rounded-t-lg px-3 py-1.5 text-[13px] font-medium ${
                rightTab === tab ? 'border-b-2 border-[var(--color-accent)] text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              {tab === 'inspector' ? 'Inspector' : 'Test'}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto">
          {rightTab === 'inspector' ? (
            <ConfigPanel
              selection={liveSelection}
              queues={queues}
              onUpdateNodeConfig={updateNodeConfig}
              onUpdateEdgeBranch={updateEdgeBranch}
              onDeleteSelection={deleteSelection}
            />
          ) : (
            <SimulatorPanel
              flow={currentDefinition}
              onHighlight={(nodeIds, edgeIds) => {
                setHighlightedNodeIds(nodeIds)
                setHighlightedEdgeIds(edgeIds)
              }}
            />
          )}
        </div>
      </aside>
    </div>
  )
}

export default function IvrEditor() {
  const { id } = useParams<{ id: string }>()
  const flowQuery = useQuery({ queryKey: ['ivr-flows', id], queryFn: () => fetchJson<IvrFlow>(`/api/ivr/flows/${id}`) })
  const queuesQuery = useQuery({ queryKey: ['queues'], queryFn: () => fetchJson<Queue[]>('/api/queues') })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/ivr" className="text-sm text-muted hover:text-ink">
            ← IVR flows
          </Link>
          {flowQuery.data && (
            <>
              <h1 className="font-display text-lg font-semibold text-ink">{flowQuery.data.name}</h1>
              <Badge tone={flowQuery.data.status === 'active' ? 'accent' : 'neutral'}>{flowQuery.data.status}</Badge>
            </>
          )}
        </div>
      </div>

      {flowQuery.isLoading || queuesQuery.isLoading ? (
        <Loader label="Loading flow…" />
      ) : flowQuery.isError || !flowQuery.data ? (
        <ErrorState label="Couldn't load this flow." onRetry={() => flowQuery.refetch()} />
      ) : (
        <ReactFlowProvider>
          <IvrEditorCanvas flow={flowQuery.data} queues={queuesQuery.data ?? []} />
        </ReactFlowProvider>
      )}
    </div>
  )
}
