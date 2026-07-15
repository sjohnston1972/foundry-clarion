import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose'
import type { KeyLike } from 'jose'
import type { VerifyOptions } from '@foundry/auth'
import type { Bindings } from '../types'

// Dev-only issuer — deliberately NOT AuthPak's, so a dev token can never be
// mistaken for (or verified as) a real AuthPak session, and vice versa.
const DEV_ISSUER = 'https://dev.local/authpak'
const DEV_AUDIENCE = 'foundry-ns'

type DevKeys = { privateKey: KeyLike; verifyOptions: VerifyOptions }

// Module-cached, generated per process. Never persisted, never leaves memory.
let keysPromise: Promise<DevKeys> | null = null

function getDevKeys(): Promise<DevKeys> {
  keysPromise ??= (async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256')
    const jwk = await exportJWK(publicKey)
    const jwks = createLocalJWKSet({ keys: [{ ...jwk, alg: 'RS256', use: 'sig' }] })
    return {
      privateKey,
      verifyOptions: { jwks, issuer: DEV_ISSUER, audience: DEV_AUDIENCE },
    }
  })()
  return keysPromise
}

/** True only when DEV_AUTH is the exact string 'true' (local wrangler dev / tests). */
export function isDevAuth(env: Bindings): boolean {
  return env.DEV_AUTH === 'true'
}

/** VerifyOptions pointing at the local dev JWKS instead of AuthPak's remote one. */
export async function devVerifyOptions(): Promise<VerifyOptions> {
  return (await getDevKeys()).verifyOptions
}

export interface DevSessionClaims {
  sub: string
  email: string
  org_id: string
  org_slug: string
  role: string
}

export async function mintDevSession(claims: DevSessionClaims): Promise<string> {
  const { privateKey } = await getDevKeys()
  return new SignJWT({ ...claims, email_verified: true })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(DEV_ISSUER)
    .setAudience(DEV_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(privateKey)
}
