import { describe, it, expect } from 'vitest'
import { jwtVerify, decodeProtectedHeader } from 'jose'
import { mintVoiceToken } from '../server/lib/twilio/token'

const env = {
  TWILIO_ACCOUNT_SID: 'AC0000000000000000000000000000000',
  TWILIO_API_KEY_SID: 'SK0000000000000000000000000000000',
  TWILIO_API_KEY_SECRET: 'super-secret-key-value',
  TWILIO_TASKROUTER_WORKSPACE_SID: 'WS0000000000000000000000000000000',
  TWILIO_TWIML_APP_SID: 'AP0000000000000000000000000000000',
} as unknown as import('../server/types').Bindings

describe('mintVoiceToken', () => {
  it('signs a Twilio-shaped Access Token with Voice + TaskRouter grants', async () => {
    const { token, identity } = await mintVoiceToken(env, { identity: 'agent@acme.com', workerSid: 'WK123' })
    expect(identity).toBe('agent@acme.com')
    const header = decodeProtectedHeader(token)
    expect(header.cty).toBe('twilio-fpa;v=1')
    const { payload } = await jwtVerify(token, new TextEncoder().encode('super-secret-key-value'))
    expect(payload.iss).toBe('SK0000000000000000000000000000000')
    expect(payload.sub).toBe('AC0000000000000000000000000000000')
    const grants = payload.grants as Record<string, unknown>
    expect(grants.identity).toBe('agent@acme.com')
    const voice = grants.voice as Record<string, unknown>
    const outgoing = voice.outgoing as Record<string, unknown>
    expect(outgoing.application_sid).toBe('AP0000000000000000000000000000000')
    const taskRouter = grants.task_router as Record<string, unknown>
    expect(taskRouter.worker_sid).toBe('WK123')
    expect(taskRouter.role).toBe('worker')
  })
  it('throws when Twilio is not configured', async () => {
    await expect(mintVoiceToken({} as never, { identity: 'x', workerSid: 'WK1' })).rejects.toThrow(/twilio_not_configured/)
  })
})
