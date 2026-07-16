import type { Bindings } from '../../types'

export type Transcript = { text: string; model: string; dryRun: boolean }

export function isAiDryRun(env: Bindings): boolean {
  return env.AI_DRY_RUN !== 'false'
}

/** Whisper over recording audio. DRY_RUN => stub, NO Workers AI call (it bills real money). */
export async function transcribeAudio(env: Bindings, audio: ArrayBuffer): Promise<Transcript> {
  if (isAiDryRun(env)) {
    return { text: '[dry-run transcript]', model: 'dryrun', dryRun: true }
  }
  // LIVE PATH — only reached after Steven flips AI_DRY_RUN=false in-session.
  const res = (await env.AI.run('@cf/openai/whisper', {
    audio: [...new Uint8Array(audio)],
  })) as { text?: string }
  return { text: res.text ?? '', model: '@cf/openai/whisper', dryRun: false }
}
