// Client-only walker for the in-browser simulator (Step 13) — deliberately NOT the same
// code as server/lib/ivr/interpret.ts: there's no real Twilio call here, so there's no
// action URL to build, no queue workflow SID to resolve, no recording-consent Say. It
// mirrors interpret.ts's walk-until-you-must-wait *shape* (same first-node-resume logic,
// same node-type switch) adapted for a preview with no I/O at all.
import { edgesFrom, findNode, type IfOp, type IvrFlowDefinition } from '@shared/ivr/graph'

export type SimVars = Record<string, string>

export type SimStepInput = {
  // The caller's DTMF response for the node being resumed. Absent => Gather timeout.
  digits?: string
  // The simulator's "after hours" toggle stands in for a real business-hours clock.
  afterHours: boolean
}

export type SimStepResult = {
  twiml: string
  terminal: boolean
  nodeId: string
  vars: SimVars
  visitedNodeIds: string[]
  visitedEdgeIds: string[]
}

const MAX_STEPS = 50

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function say(text: string): string {
  return `<Say>${escapeXml(text)}</Say>`
}

function edgeTo(flow: IvrFlowDefinition, nodeId: string, branch: string) {
  return edgesFrom(flow, nodeId).find((e) => e.branch === branch) ?? null
}

function resolveValue(value: string, vars: SimVars): string {
  return value.startsWith('$') ? (vars[value.slice(1)] ?? '') : value
}

function evaluateIf(config: { left: string; op: IfOp; right: string }, vars: SimVars): boolean {
  const left = resolveValue(config.left, vars)
  const right = resolveValue(config.right, vars)
  switch (config.op) {
    case 'eq': return left === right
    case 'neq': return left !== right
    case 'gt': return Number(left) > Number(right)
    case 'lt': return Number(left) < Number(right)
    case 'gte': return Number(left) >= Number(right)
    case 'lte': return Number(left) <= Number(right)
  }
}

function resolveMenuBranch(flow: IvrFlowDefinition, nodeId: string, digits: string | undefined): string {
  if (!digits) return 'timeout'
  return edgeTo(flow, nodeId, digits) ? digits : 'invalid'
}

export function simulateStep(flow: IvrFlowDefinition, nodeId: string, vars: SimVars, input: SimStepInput): SimStepResult {
  let current = nodeId
  let currentVars: SimVars = { ...vars }
  let twiml = ''
  let first = true
  const visitedNodeIds: string[] = []
  const visitedEdgeIds: string[] = []

  function bail(reason: string): SimStepResult {
    console.error('ivr_simulate_bail', reason, current)
    return { twiml: twiml + '<Hangup/>', terminal: true, nodeId: current, vars: currentVars, visitedNodeIds, visitedEdgeIds }
  }

  // Follows `branch` out of `fromId`, recording the edge and advancing `current`.
  // Returns false (caller should bail) if the flow has no such edge — a currently-invalid
  // graph is exactly what the simulator exists to catch, so this must degrade gracefully.
  function follow(fromId: string, branch: string): boolean {
    const edge = edgeTo(flow, fromId, branch)
    if (!edge) return false
    visitedEdgeIds.push(`${edge.source}::${edge.branch}::${edge.target}`)
    current = edge.target
    return true
  }

  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const node = findNode(flow, current)
    if (!node) return bail('unknown_node')
    visitedNodeIds.push(node.id)

    if (first && node.type === 'menu') {
      const branch = resolveMenuBranch(flow, node.id, input.digits)
      if (!follow(node.id, branch)) return bail(`missing_branch:${branch}`)
      first = false
      continue
    }
    if (first && node.type === 'collect') {
      currentVars = { ...currentVars, [node.config.variable]: input.digits ?? '' }
      if (!follow(node.id, 'next')) return bail('missing_branch:next')
      first = false
      continue
    }
    first = false

    switch (node.type) {
      case 'start': {
        if (!follow(node.id, 'next')) return bail('missing_branch:next')
        continue
      }
      case 'play': {
        twiml += say(node.config.say)
        if (!follow(node.id, 'next')) return bail('missing_branch:next')
        continue
      }
      case 'if': {
        const branch = evaluateIf(node.config, currentVars) ? 'true' : 'false'
        if (!follow(node.id, branch)) return bail(`missing_branch:${branch}`)
        continue
      }
      case 'businessHours': {
        const branch = input.afterHours ? 'closed' : 'open'
        if (!follow(node.id, branch)) return bail(`missing_branch:${branch}`)
        continue
      }
      case 'menu': {
        twiml += `<Gather numDigits="1" timeout="${node.config.timeoutSeconds}">${say(node.config.prompt)}</Gather>`
        return { twiml, terminal: false, nodeId: node.id, vars: currentVars, visitedNodeIds, visitedEdgeIds }
      }
      case 'collect': {
        twiml += `<Gather numDigits="${node.config.numDigits}">${say(node.config.prompt)}</Gather>`
        return { twiml, terminal: false, nodeId: node.id, vars: currentVars, visitedNodeIds, visitedEdgeIds }
      }
      case 'routeToQueue': {
        twiml += `<Enqueue>${escapeXml(node.config.queueId)}</Enqueue>`
        return { twiml, terminal: true, nodeId: node.id, vars: currentVars, visitedNodeIds, visitedEdgeIds }
      }
      case 'voicemail': {
        twiml += say(node.config.prompt) + `<Record maxLength="${node.config.maxLengthSeconds}"/>`
        return { twiml, terminal: true, nodeId: node.id, vars: currentVars, visitedNodeIds, visitedEdgeIds }
      }
      case 'hangup': {
        twiml += '<Hangup/>'
        return { twiml, terminal: true, nodeId: node.id, vars: currentVars, visitedNodeIds, visitedEdgeIds }
      }
    }
  }

  return bail('max_steps_exceeded')
}
