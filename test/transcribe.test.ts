import { describe, it, expect, vi } from 'vitest'
import { transcribeAudio, isAiDryRun } from '../server/lib/ai/transcribe'
import type { Bindings } from '../server/types'

const audio = new TextEncoder().encode('fake-audio-bytes').buffer as ArrayBuffer

// The fake AI's run THROWS if invoked — that is the cost-rail assertion: under
// dry-run, no Workers AI call may escape (it bills real money, no local simulator).
function throwingAi() {
  const run = vi.fn(async () => { throw new Error('AI.run must never be called under AI_DRY_RUN') })
  return { ai: { run } as unknown as Ai, run }
}

function envWith(ai: Ai, aiDryRun?: string): Bindings {
  return { AI: ai, AI_DRY_RUN: aiDryRun } as unknown as Bindings
}

describe('transcribeAudio behind AI_DRY_RUN', () => {
  it('AI_DRY_RUN unset (the default) => stub returned, AI.run never called', async () => {
    const { ai, run } = throwingAi()
    expect(isAiDryRun(envWith(ai))).toBe(true)
    const out = await transcribeAudio(envWith(ai), audio)
    expect(out).toEqual({ text: '[dry-run transcript]', model: 'dryrun', dryRun: true })
    expect(run).not.toHaveBeenCalled()
  })

  it("AI_DRY_RUN='true' => same stub, still no call", async () => {
    const { ai, run } = throwingAi()
    const out = await transcribeAudio(envWith(ai, 'true'), audio)
    expect(out.dryRun).toBe(true)
    expect(run).not.toHaveBeenCalled()
  })

  it("AI_DRY_RUN='false' with a fake AI => the fake's text comes back via Whisper", async () => {
    const run = vi.fn(async () => ({ text: 'hello from whisper' }))
    const out = await transcribeAudio(envWith({ run } as unknown as Ai, 'false'), audio)
    expect(out).toEqual({ text: 'hello from whisper', model: '@cf/openai/whisper', dryRun: false })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][0]).toBe('@cf/openai/whisper')
    // The audio reaches Whisper as a plain number array (the Workers AI input shape).
    const input = run.mock.calls[0][1] as { audio: number[] }
    expect(Array.isArray(input.audio)).toBe(true)
    expect(input.audio.length).toBe(audio.byteLength)
  })
})
