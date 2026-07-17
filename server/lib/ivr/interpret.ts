import { edgesFrom, findNode, type IfOp, type IvrFlowDefinition, type IvrNode } from './graph'

export type Vars = Record<string, string>

export type InterpretInput = {
  // The caller's DTMF response for the node we're resuming (menu/collect). Absent ⇒ a
  // Gather timeout (Twilio posts back with no Digits param).
  digits?: string
  // Injected "now" so businessHours is deterministic under test — never Date.now() here.
  now: Date
  // Builds the action URL for a Gather (menu/collect) — encodes node + vars so the
  // continuation round-trips through the webhook's query string. Called at most once
  // per interpret() call, for the single waiting node the walk stops at.
  buildGatherActionUrl: (nodeId: string, vars: Vars) => string
  // Pre-built (static for the whole HTTP request — no vars to encode, voicemail is terminal).
  voicemailActionUrl: string
  voicemailStatusCallbackUrl: string
  // queueId -> Twilio Workflow SID, resolved by the caller (interpret does no DB/IO).
  queueWorkflowSids: Record<string, string>
  // Pre-built, already-escaped <Task>...</Task> fragment for Enqueue.
  enqueueTaskXml: string
  // '' when the org has recording disabled; otherwise a ready-made <Say>...</Say> —
  // mirrors the recording-consent invariant from server/routes/voice.ts.
  recordingConsentSay: string
}

export type InterpretResult = {
  twiml: string
  terminal: boolean
  nodeId: string
  vars: Vars
}

// Guards against an accidental cycle of linear nodes looping forever within one request.
export const MAX_STEPS = 50

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function say(text: string): string {
  return `<Say>${escapeXml(text)}</Say>`
}

function targetFor(flow: IvrFlowDefinition, nodeId: string, branch: string): string | null {
  return edgesFrom(flow, nodeId).find((e) => e.branch === branch)?.target ?? null
}

function resolveValue(value: string, vars: Vars): string {
  return value.startsWith('$') ? (vars[value.slice(1)] ?? '') : value
}

function evaluateIf(config: { left: string; op: IfOp; right: string }, vars: Vars): boolean {
  const left = resolveValue(config.left, vars)
  const right = resolveValue(config.right, vars)
  switch (config.op) {
    case 'eq':
      return left === right
    case 'neq':
      return left !== right
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      const l = Number(left)
      const r = Number(right)
      if (Number.isNaN(l) || Number.isNaN(r)) return false
      if (config.op === 'gt') return l > r
      if (config.op === 'lt') return l < r
      if (config.op === 'gte') return l >= r
      return l <= r
    }
  }
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

// Day convention: JS Date.getDay() (0 = Sunday .. 6 = Saturday) — not locked by the spec
// beyond its single example, so we align with the runtime's own convention.
function nowInZone(now: Date, timeZone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const map: Record<string, string> = {}
  for (const p of parts) map[p.type] = p.value
  const day = WEEKDAY_INDEX[map.weekday] ?? now.getUTCDay()
  const minutes = (Number(map.hour) % 24) * 60 + Number(map.minute)
  return { day, minutes }
}

function parseHm(hm: string): number {
  const [h, m] = hm.split(':').map(Number)
  return h * 60 + m
}

function isBusinessHoursOpen(config: { timezone: string; weekly: { day: number; open: string; close: string }[] }, now: Date): boolean {
  const { day, minutes } = nowInZone(now, config.timezone)
  return config.weekly.some((w) => w.day === day && minutes >= parseHm(w.open) && minutes < parseHm(w.close))
}

function resolveMenuBranch(flow: IvrFlowDefinition, node: IvrNode, digits: string | undefined): string {
  if (!digits) return 'timeout'
  return targetFor(flow, node.id, digits) !== null ? digits : 'invalid'
}

function bail(twiml: string, nodeId: string, vars: Vars, reason: string): InterpretResult {
  console.error('ivr_interpret_bail', reason, nodeId)
  return { twiml: twiml + '<Hangup/>', terminal: true, nodeId, vars }
}

// Pure core: walks the flow graph from `nodeId`, chaining TwiML, until it reaches a node
// that must wait for the caller (menu/collect) or terminates (routeToQueue/voicemail/hangup).
// No D1/Twilio I/O — everything the walk needs is passed in via `input`.
export function interpret(flow: IvrFlowDefinition, nodeId: string, vars: Vars, input: InterpretInput): InterpretResult {
  let current = nodeId
  let currentVars: Vars = { ...vars }
  let twiml = ''
  let first = true

  for (let steps = 0; steps < MAX_STEPS; steps++) {
    const node = findNode(flow, current)
    if (!node) return bail(twiml, current, currentVars, 'unknown_node')

    // Only the node we were asked to resume can consume this round's caller input —
    // every other menu/collect reached later in the same walk is a fresh encounter.
    if (first && node.type === 'menu') {
      const branch = resolveMenuBranch(flow, node, input.digits)
      const target = targetFor(flow, node.id, branch)
      if (!target) return bail(twiml, node.id, currentVars, `missing_branch:${branch}`)
      current = target
      first = false
      continue
    }
    if (first && node.type === 'collect') {
      currentVars = { ...currentVars, [node.config.variable]: input.digits ?? '' }
      const target = targetFor(flow, node.id, 'next')
      if (!target) return bail(twiml, node.id, currentVars, 'missing_branch:next')
      current = target
      first = false
      continue
    }
    first = false

    switch (node.type) {
      case 'start': {
        const target = targetFor(flow, node.id, 'next')
        if (!target) return bail(twiml, node.id, currentVars, 'missing_branch:next')
        current = target
        continue
      }
      case 'play': {
        twiml += say(node.config.say)
        const target = targetFor(flow, node.id, 'next')
        if (!target) return bail(twiml, node.id, currentVars, 'missing_branch:next')
        current = target
        continue
      }
      case 'if': {
        const branch = evaluateIf(node.config, currentVars) ? 'true' : 'false'
        const target = targetFor(flow, node.id, branch)
        if (!target) return bail(twiml, node.id, currentVars, `missing_branch:${branch}`)
        current = target
        continue
      }
      case 'businessHours': {
        const branch = isBusinessHoursOpen(node.config, input.now) ? 'open' : 'closed'
        const target = targetFor(flow, node.id, branch)
        if (!target) return bail(twiml, node.id, currentVars, `missing_branch:${branch}`)
        current = target
        continue
      }
      case 'menu': {
        const action = input.buildGatherActionUrl(node.id, currentVars)
        twiml += `<Gather numDigits="1" timeout="${node.config.timeoutSeconds}" action="${action}">${say(node.config.prompt)}</Gather>`
        return { twiml, terminal: false, nodeId: node.id, vars: currentVars }
      }
      case 'collect': {
        const action = input.buildGatherActionUrl(node.id, currentVars)
        twiml += `<Gather numDigits="${node.config.numDigits}" action="${action}">${say(node.config.prompt)}</Gather>`
        return { twiml, terminal: false, nodeId: node.id, vars: currentVars }
      }
      case 'routeToQueue': {
        const workflowSid = input.queueWorkflowSids[node.config.queueId]
        if (!workflowSid) return bail(twiml, node.id, currentVars, `unknown_queue:${node.config.queueId}`)
        twiml += `${input.recordingConsentSay}<Enqueue workflowSid="${workflowSid}">${input.enqueueTaskXml}</Enqueue>`
        return { twiml, terminal: true, nodeId: node.id, vars: currentVars }
      }
      case 'voicemail': {
        twiml += say(node.config.prompt)
        twiml += `<Record maxLength="${node.config.maxLengthSeconds}" action="${input.voicemailActionUrl}" recordingStatusCallback="${input.voicemailStatusCallbackUrl}" />`
        return { twiml, terminal: true, nodeId: node.id, vars: currentVars }
      }
      case 'hangup': {
        twiml += '<Hangup/>'
        return { twiml, terminal: true, nodeId: node.id, vars: currentVars }
      }
    }
  }

  return bail(twiml, current, currentVars, 'max_steps_exceeded')
}
