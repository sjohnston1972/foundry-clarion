import type { Bindings } from '../../types'
import { setTranscript } from '../../db/recordings'

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

/** R2 -> Whisper -> R2 + cc_recordings. Never throws: failure sets transcript_status='failed'. */
export async function transcribeRecording(
  env: Bindings, opts: { orgId: string; recordingId: string; r2Key: string },
): Promise<void> {
  try {
    const obj = await env.RECORDINGS.get(opts.r2Key)
    if (!obj) {
      await setTranscript(env.DB, opts.orgId, opts.recordingId, { transcriptR2Key: null, transcriptStatus: 'failed' })
      return
    }
    const transcript = await transcribeAudio(env, await obj.arrayBuffer())
    const key = `${opts.r2Key.replace(/\.mp3$/, '')}.transcript.json`
    await env.RECORDINGS.put(key, JSON.stringify(transcript))
    await setTranscript(env.DB, opts.orgId, opts.recordingId, { transcriptR2Key: key, transcriptStatus: 'done' })
  } catch (e) {
    console.error('transcribeRecording failed', e)
    await setTranscript(env.DB, opts.orgId, opts.recordingId, { transcriptR2Key: null, transcriptStatus: 'failed' })
  }
}
