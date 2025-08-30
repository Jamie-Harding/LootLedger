import crypto from 'node:crypto'
import { generateVerifier, challengeFromVerifier } from './pkce'

// UI authorize page
export const TICKTICK_AUTH = 'https://ticktick.com/oauth/authorize'

// Proxy base URL from env (wrangler gives you workers.dev URL)
export const TOKEN_PROXY_URL = process.env.TOKEN_PROXY_URL ?? ''

// Public client_id (safe to ship); MUST match the one configured in the Worker
export const CLIENT_ID =
  process.env.TICKTICK_CLIENT_ID ?? 'REPLACE_ME_CLIENT_ID'

export const SCOPE = 'tasks:read tasks:write'

export type AuthStartResult = { url: string; verifier: string; state: string }

export async function buildAuthUrl(
  redirectUri: string,
): Promise<AuthStartResult> {
  if (!CLIENT_ID || CLIENT_ID === 'REPLACE_ME_CLIENT_ID') {
    throw new Error('CLIENT_ID is not set')
  }
  const verifier = generateVerifier()
  const challenge = await challengeFromVerifier(verifier)
  const state = crypto.randomUUID()

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
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
  if (!TOKEN_PROXY_URL) throw new Error('TOKEN_PROXY_URL not set')

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    // client_id is included, but the proxy will override it to ensure consistency
    client_id: CLIENT_ID,
    code,
    redirect_uri: redirectUri,
    code_verifier: verifier,
    scope: SCOPE,
  })

  // Accept both "/" and "/oauth/token" on the proxy
  const res = await fetch(`${TOKEN_PROXY_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`proxy token exchange failed ${res.status}: ${text}`)
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
  if (!TOKEN_PROXY_URL) throw new Error('TOKEN_PROXY_URL not set')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    refresh_token,
    scope: SCOPE,
  })

  const res = await fetch(`${TOKEN_PROXY_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`proxy refresh failed ${res.status}: ${text}`)
  }
  return res.json() as Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
  }>
}
