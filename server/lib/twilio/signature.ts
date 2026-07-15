// Twilio request-signing algorithm: HMAC-SHA1(authToken, url + sorted "key"+"value" pairs), base64.
// https://www.twilio.com/docs/usage/security#validating-requests

function base64FromBuffer(buf: ArrayBuffer): string {
  let binary = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary)
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  let data = url
  for (const key of Object.keys(params).sort()) data += key + params[key]
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return base64FromBuffer(sigBuf)
}

/** Validates an inbound Twilio webhook. Fails closed: no auth token or no header => invalid. */
export async function isValidTwilioSignature(
  authToken: string | undefined,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): Promise<boolean> {
  if (!authToken || !signature) return false
  const expected = await computeTwilioSignature(authToken, url, params)
  return timingSafeEqualStr(expected, signature)
}
