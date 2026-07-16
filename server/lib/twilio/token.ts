import { SignJWT } from 'jose'
import type { Bindings } from '../../types'

const TTL_SECONDS = 3600

export async function mintVoiceToken(
  env: Bindings,
  args: { identity: string; workerSid: string },
): Promise<{ token: string; identity: string; expiresAt: number }> {
  const { TWILIO_ACCOUNT_SID: acct, TWILIO_API_KEY_SID: keySid, TWILIO_API_KEY_SECRET: keySecret,
    TWILIO_TASKROUTER_WORKSPACE_SID: workspaceSid, TWILIO_TWIML_APP_SID: appSid } = env
  if (!acct || !keySid || !keySecret || !workspaceSid || !appSid) {
    throw new Error('twilio_not_configured')
  }
  const now = Math.floor(Date.now() / 1000)
  const expiresAt = now + TTL_SECONDS
  const grants = {
    identity: args.identity,
    voice: { incoming: { allow: true }, outgoing: { application_sid: appSid } },
    task_router: { workspace_sid: workspaceSid, worker_sid: args.workerSid, role: 'worker' },
  }
  const token = await new SignJWT({ grants })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT', cty: 'twilio-fpa;v=1' })
    .setIssuer(keySid)
    .setSubject(acct)
    .setIssuedAt(now)
    .setNotBefore(now)
    .setExpirationTime(expiresAt)
    .setJti(`${keySid}-${now}`)
    .sign(new TextEncoder().encode(keySecret))
  return { token, identity: args.identity, expiresAt }
}
