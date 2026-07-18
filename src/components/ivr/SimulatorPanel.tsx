import { useState } from 'react'
import { Button } from '../ui'
import { simulateStep, type SimVars } from '../../lib/ivr/simulate'
import type { IvrFlowDefinition, IvrNodeType } from '@shared/ivr/graph'

type Props = {
  flow: IvrFlowDefinition
  onHighlight: (nodeIds: Set<string>, edgeIds: Set<string>) => void
}

type SimState =
  | { phase: 'idle' }
  | { phase: 'running'; nodeId: string; vars: SimVars; twiml: string; terminal: boolean; waitingType: Extract<IvrNodeType, 'menu' | 'collect'> | null }

const MENU_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

export function SimulatorPanel({ flow, onHighlight }: Props) {
  const [afterHours, setAfterHours] = useState(false)
  const [state, setState] = useState<SimState>({ phase: 'idle' })
  const [digitsInput, setDigitsInput] = useState('')
  const [visitedNodes, setVisitedNodes] = useState<Set<string>>(new Set())
  const [visitedEdges, setVisitedEdges] = useState<Set<string>>(new Set())

  const advance = (digits?: string) => {
    const nodeId = state.phase === 'running' ? state.nodeId : flow.entryNodeId
    const vars = state.phase === 'running' ? state.vars : {}
    const result = simulateStep(flow, nodeId, vars, { digits, afterHours })

    const nextVisitedNodes = new Set(visitedNodes)
    result.visitedNodeIds.forEach((id) => nextVisitedNodes.add(id))
    const nextVisitedEdges = new Set(visitedEdges)
    result.visitedEdgeIds.forEach((id) => nextVisitedEdges.add(id))
    setVisitedNodes(nextVisitedNodes)
    setVisitedEdges(nextVisitedEdges)
    onHighlight(nextVisitedNodes, nextVisitedEdges)

    const nodeType = flow.nodes.find((n) => n.id === result.nodeId)?.type
    const waitingType = !result.terminal && (nodeType === 'menu' || nodeType === 'collect') ? nodeType : null
    setState({
      phase: 'running',
      nodeId: result.nodeId,
      vars: result.vars,
      twiml: (state.phase === 'running' ? state.twiml : '') + result.twiml,
      terminal: result.terminal,
      waitingType,
    })
    setDigitsInput('')
  }

  const reset = () => {
    setState({ phase: 'idle' })
    setDigitsInput('')
    setVisitedNodes(new Set())
    setVisitedEdges(new Set())
    onHighlight(new Set(), new Set())
  }

  return (
    <div className="flex h-full flex-col p-4">
      <div className="text-[11px] font-medium uppercase tracking-wide text-faint">Test flow</div>
      <p className="mt-1 text-xs text-muted">Walks the flow in your browser — no real call is made.</p>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={afterHours}
          onChange={(e) => {
            setAfterHours(e.target.checked)
            reset()
          }}
        />
        Simulate after-hours
      </label>

      <div className="mt-4">
        {state.phase === 'idle' && (
          <Button variant="primary" size="sm" onClick={() => advance(undefined)}>
            Start test call
          </Button>
        )}

        {state.phase === 'running' && state.waitingType === 'menu' && (
          <div>
            <div className="mb-1 text-xs text-muted">Press a key:</div>
            <div className="grid grid-cols-5 gap-1.5">
              {MENU_KEYS.map((key) => (
                <Button key={key} size="sm" onClick={() => advance(key)}>
                  {key}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" className="mt-2" onClick={() => advance(undefined)}>
              Simulate timeout (no input)
            </Button>
          </div>
        )}

        {state.phase === 'running' && state.waitingType === 'collect' && (
          <div className="flex items-center gap-2">
            <input
              value={digitsInput}
              onChange={(e) => setDigitsInput(e.target.value.replace(/\D/g, ''))}
              placeholder="Digits"
              className="h-8 w-28 rounded-lg border border-line bg-surface px-2 text-sm text-ink"
            />
            <Button size="sm" onClick={() => advance(digitsInput)}>
              Submit
            </Button>
          </div>
        )}

        {state.phase === 'running' && state.terminal && (
          <p className="text-sm font-medium text-emerald-600">Call ended.</p>
        )}

        {state.phase === 'running' && (
          <Button size="sm" variant="outline" className="mt-3" onClick={reset}>
            Restart
          </Button>
        )}
      </div>

      {state.phase === 'running' && (
        <div className="mt-4 flex-1 overflow-y-auto">
          <div className="text-[11px] font-medium uppercase tracking-wide text-faint">TwiML so far</div>
          <pre className="mt-1 whitespace-pre-wrap break-all rounded-lg bg-canvas p-2 font-mono text-[11px] text-ink-2">
            {state.twiml || '(none yet)'}
          </pre>
        </div>
      )}
    </div>
  )
}
