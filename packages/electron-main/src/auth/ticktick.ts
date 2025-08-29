import crypto from 'node:crypto'
import { generateVerifier, challengeFromVerifier } from './pkce'

// Authz page is on ticktick.com; token API is on api.ticktick.com
export const TICKTICK_AUTH = 'https://ticktick.com/oauth/authorize'
export const TICKTICK_TOKEN = 'https://api.ticktick.com/oauth/token'

export const CLIENT_ID = process.env.TICKTICK_CLIENT_ID ?? '1987QO8z862eqOITJq'
export const SCOPE = 'tasks:read tasks:write'

export type AuthStartResult = { url: string; verifier: string; state: string }

export async function buildAuthUrl(
  redirectUri: string,
): Promise<AuthStartResult> {
  if (!CLIENT_ID) throw new Error('CLIENT_ID is not set')

  const verifier = generateVerifier()
  const challenge = await challengeFromVerifier(verifier)
  const state = crypto.randomUUID()

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri, // http://127.0.0.1:8802/oauth/callback
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: SCOPE,
    state,
  })

  return { url: `${TICKTICK_AUTH}?${params.toString()}`, verifier, state }
}

export async function exchangeCode({
  code,
  redirectUri,
  verifier,
}: {
  code: string
  redirectUri: string
  verifier: string
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  })

  const res = await fetch(TICKTICK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`token exchange failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<{
    access_token: string
    refresh_token: string
    expires_in: number
  }>
}

export async function refreshToken({
  refresh_token,
}: {
  refresh_token: string
}) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token,
  })
  const res = await fetch(TICKTICK_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`refresh failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
  }>
}
