export type WeeklyHours = { day: number; open: string; close: string }

export type IfOp = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'

export type NodePosition = { x: number; y: number }

type BaseNode = { id: string; position: NodePosition }

export type StartNode = BaseNode & { type: 'start'; config: Record<string, never> }
export type PlayNode = BaseNode & { type: 'play'; config: { say: string } }
export type MenuNode = BaseNode & { type: 'menu'; config: { prompt: string; timeoutSeconds: number } }
export type CollectNode = BaseNode & { type: 'collect'; config: { prompt: string; numDigits: number; variable: string } }
export type IfNode = BaseNode & { type: 'if'; config: { left: string; op: IfOp; right: string } }
export type BusinessHoursNode = BaseNode & { type: 'businessHours'; config: { timezone: string; weekly: WeeklyHours[] } }
export type RouteToQueueNode = BaseNode & { type: 'routeToQueue'; config: { queueId: string } }
export type VoicemailNode = BaseNode & { type: 'voicemail'; config: { prompt: string; maxLengthSeconds: number } }
export type HangupNode = BaseNode & { type: 'hangup'; config: Record<string, never> }

export type IvrNode =
  | StartNode
  | PlayNode
  | MenuNode
  | CollectNode
  | IfNode
  | BusinessHoursNode
  | RouteToQueueNode
  | VoicemailNode
  | HangupNode

export type IvrNodeType = IvrNode['type']

export type IvrEdge = { source: string; target: string; branch: string }

export type IvrFlowDefinition = {
  entryNodeId: string
  nodes: IvrNode[]
  edges: IvrEdge[]
}

// Nodes that end the call — no outgoing edges are required or followed.
export const TERMINAL_NODE_TYPES: ReadonlySet<IvrNodeType> = new Set(['routeToQueue', 'voicemail', 'hangup'])

// Nodes that pause the interpreter waiting on caller input (Gather/Record) rather than
// chaining straight through — see server/lib/ivr/interpret.ts (Step 4).
export const WAITING_NODE_TYPES: ReadonlySet<IvrNodeType> = new Set(['menu', 'collect', 'voicemail'])

export function isTerminalNode(node: IvrNode): boolean {
  return TERMINAL_NODE_TYPES.has(node.type)
}

export function edgesFrom(flow: IvrFlowDefinition, nodeId: string): IvrEdge[] {
  return flow.edges.filter((e) => e.source === nodeId)
}

export function findNode(flow: IvrFlowDefinition, nodeId: string): IvrNode | undefined {
  return flow.nodes.find((n) => n.id === nodeId)
}

// The starter graph for a brand-new flow: a single, unconnected start node.
export function emptyFlowDefinition(startNodeId = 'n_start'): IvrFlowDefinition {
  return {
    entryNodeId: startNodeId,
    nodes: [{ id: startNodeId, type: 'start', position: { x: 0, y: 0 }, config: {} }],
    edges: [],
  }
}
