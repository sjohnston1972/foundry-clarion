import { edgesFrom, isTerminalNode, type IvrFlowDefinition, type IvrNode } from './graph'

export type ValidateContext = { queueIds: string[] }

export type ValidationResult = { valid: boolean; errors: string[] }

const DIGIT = /^[0-9]$/
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

// Rule 1: exactly one start node; entryNodeId points to it.
function checkSingleStart(flow: IvrFlowDefinition): string[] {
  const starts = flow.nodes.filter((n) => n.type === 'start')
  if (starts.length !== 1) {
    return [`flow must have exactly one start node (found ${starts.length})`]
  }
  if (flow.entryNodeId !== starts[0].id) {
    return ['entryNodeId must point to the start node']
  }
  return []
}

function requiredBranches(node: IvrNode): string[] {
  switch (node.type) {
    case 'start':
    case 'play':
    case 'collect':
      return ['next']
    case 'menu':
      return ['timeout', 'invalid']
    case 'if':
      return ['true', 'false']
    case 'businessHours':
      return ['open', 'closed']
    default:
      return []
  }
}

// Rule 2: every non-terminal node has an outgoing edge for each required branch
// (menu additionally needs at least one digit-key branch).
function checkRequiredBranches(flow: IvrFlowDefinition): string[] {
  const errors: string[] = []
  for (const node of flow.nodes) {
    if (isTerminalNode(node)) continue
    const branches = edgesFrom(flow, node.id).map((e) => e.branch)
    for (const required of requiredBranches(node)) {
      if (!branches.includes(required)) {
        errors.push(`node "${node.id}" (${node.type}) is missing its required "${required}" branch`)
      }
    }
    if (node.type === 'menu' && !branches.some((b) => DIGIT.test(b))) {
      errors.push(`menu node "${node.id}" must have at least one digit-key branch`)
    }
  }
  return errors
}

// Rule 3: no orphan nodes — every node is reachable from start.
function checkNoOrphans(flow: IvrFlowDefinition): string[] {
  const visited = new Set<string>()
  const stack = [flow.entryNodeId]
  while (stack.length) {
    const id = stack.pop()!
    if (visited.has(id)) continue
    visited.add(id)
    for (const e of edgesFrom(flow, id)) stack.push(e.target)
  }
  const orphans = flow.nodes.filter((n) => !visited.has(n.id))
  return orphans.map((n) => `node "${n.id}" (${n.type}) is not reachable from the start node`)
}

// Rule 4: every path terminates — no node is stuck unable to ever reach a terminal node.
function checkAllPathsTerminate(flow: IvrFlowDefinition): string[] {
  const canReachTerminal = new Set<string>()
  const stack = flow.nodes.filter(isTerminalNode).map((n) => n.id)
  const incoming = new Map<string, string[]>()
  for (const e of flow.edges) {
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    incoming.get(e.target)!.push(e.source)
  }
  while (stack.length) {
    const id = stack.pop()!
    if (canReachTerminal.has(id)) continue
    canReachTerminal.add(id)
    for (const src of incoming.get(id) ?? []) stack.push(src)
  }
  const deadEnds = flow.nodes.filter((n) => !isTerminalNode(n) && !canReachTerminal.has(n.id))
  return deadEnds.map((n) => `node "${n.id}" (${n.type}) has no path to a terminal node (routeToQueue/voicemail/hangup)`)
}

// Rule 5: menu keys are unique digits; collect.variable is a valid identifier;
// routeToQueue.queueId exists in the org.
function checkNodeConfigs(flow: IvrFlowDefinition, ctx: ValidateContext): string[] {
  const errors: string[] = []
  for (const node of flow.nodes) {
    if (node.type === 'menu') {
      const keys = edgesFrom(flow, node.id)
        .map((e) => e.branch)
        .filter((b) => DIGIT.test(b))
      const seen = new Set<string>()
      for (const key of keys) {
        if (seen.has(key)) errors.push(`menu node "${node.id}" has a duplicate key branch "${key}"`)
        seen.add(key)
      }
    }
    if (node.type === 'collect' && !IDENTIFIER.test(node.config.variable)) {
      errors.push(`collect node "${node.id}" has an invalid variable name "${node.config.variable}"`)
    }
    if (node.type === 'routeToQueue' && !ctx.queueIds.includes(node.config.queueId)) {
      errors.push(`routeToQueue node "${node.id}" references unknown queue "${node.config.queueId}"`)
    }
  }
  return errors
}

export function validateFlow(flow: IvrFlowDefinition, ctx: ValidateContext): ValidationResult {
  const errors = [
    ...checkSingleStart(flow),
    ...checkRequiredBranches(flow),
    ...checkNoOrphans(flow),
    ...checkAllPathsTerminate(flow),
    ...checkNodeConfigs(flow, ctx),
  ]
  return { valid: errors.length === 0, errors }
}
