import {
  PlayCircle, Volume2, ListTree, Hash, GitBranch, Clock, ArrowRightCircle, Voicemail, PhoneOff,
} from 'lucide-react'
import { TERMINAL_NODE_TYPES, type IvrNode, type IvrNodeType } from '@shared/ivr/graph'

export type NodeMeta = {
  label: string
  icon: typeof PlayCircle
  accent: string // tailwind text-color class for the icon + left border
  defaultConfig: IvrNode['config']
  summary: (config: never) => string
}

// One entry per v1 node type — label/icon/accent for the canvas + palette, and the
// starter config a freshly-dropped node gets (deliberately minimal, editable right away
// in the config panel).
export const NODE_META: Record<IvrNodeType, NodeMeta> = {
  start: {
    label: 'Start', icon: PlayCircle, accent: 'text-emerald-600', defaultConfig: {},
    summary: () => 'Entry point',
  },
  play: {
    label: 'Play / Say', icon: Volume2, accent: 'text-sky-600', defaultConfig: { say: 'Thanks for calling.' },
    summary: (c) => (c as { say: string }).say,
  },
  menu: {
    label: 'Menu', icon: ListTree, accent: 'text-violet-600',
    defaultConfig: { prompt: 'Press 1 for Sales, 2 for Support.', timeoutSeconds: 5 },
    summary: (c) => (c as { prompt: string }).prompt,
  },
  collect: {
    label: 'Collect digits', icon: Hash, accent: 'text-violet-600',
    defaultConfig: { prompt: 'Enter your account number.', numDigits: 6, variable: 'input' },
    summary: (c) => (c as { prompt: string }).prompt,
  },
  if: {
    label: 'If / branch', icon: GitBranch, accent: 'text-amber-600',
    defaultConfig: { left: '$input', op: 'eq', right: '' },
    summary: (c) => { const cfg = c as { left: string; op: string; right: string }; return `${cfg.left} ${cfg.op} ${cfg.right}` },
  },
  businessHours: {
    label: 'Business hours', icon: Clock, accent: 'text-amber-600',
    defaultConfig: { timezone: 'UTC', weekly: [{ day: 1, open: '09:00', close: '17:00' }] },
    summary: (c) => (c as { timezone: string }).timezone,
  },
  routeToQueue: {
    label: 'Route to queue', icon: ArrowRightCircle, accent: 'text-blue-600',
    defaultConfig: { queueId: '' },
    summary: (c) => (c as { queueId: string }).queueId || '(no queue selected)',
  },
  voicemail: {
    label: 'Voicemail', icon: Voicemail, accent: 'text-rose-600',
    defaultConfig: { prompt: 'Leave a message after the tone.', maxLengthSeconds: 120 },
    summary: (c) => (c as { prompt: string }).prompt,
  },
  hangup: {
    label: 'Hangup', icon: PhoneOff, accent: 'text-slate-500', defaultConfig: {},
    summary: () => 'Ends the call',
  },
}

export const NODE_TYPES: IvrNodeType[] = ['start', 'play', 'menu', 'collect', 'if', 'businessHours', 'routeToQueue', 'voicemail', 'hangup']

// Terminal node types never get an outgoing connection handle on the canvas.
export const TERMINAL_TYPES = TERMINAL_NODE_TYPES

// The branch names a new edge from this node type should offer in the edge panel.
export function branchOptionsFor(type: IvrNodeType): string[] | null {
  switch (type) {
    case 'if': return ['true', 'false']
    case 'businessHours': return ['open', 'closed']
    case 'menu': return ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'timeout', 'invalid']
    default: return null // linear nodes always use "next" — not user-editable
  }
}
