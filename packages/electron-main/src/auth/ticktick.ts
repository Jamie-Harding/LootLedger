// packages/electron-main/src/auth/ticktick.ts
import crypto from 'node:crypto'
import { generateVerifier, challengeFromVerifier } from './pkce'

export const TICKTICK_AUTH = 'https://ticktick.com/oauth/authorize'

// Read from env (loaded by dotenv in main.ts)
export const TOKEN_PROXY_URL = process.env.TOKEN_PROXY_URL ?? ''
export const CLIENT_ID =
  process.env.TICKTICK_CLIENT_ID ?? 'REPLACE_ME_CLIENT_ID'
export const SCOPE = 'tasks:read tasks:write'

// Debug what we actually loaded
console.log('[auth] env CLIENT_ID:', CLIENT_ID)
console.log('[auth] env TOKEN_PROXY_URL:', TOKEN_PROXY_URL)

export type AuthStartResult = { url: string; verifier: string; state: string }

export async function buildAuthUrl(
  redirectUri: string,
): Promise<AuthStartResult> {
  // ✅ Only fail if the true placeholder is present or empty
  if (!CLIENT_ID || CLIENT_ID === 'REPLACE_ME_CLIENT_ID') {
    throw new Error('CLIENT_ID is not set')
  }

  const verifier = generateVerifier()
  const challenge = await challengeFromVerifier(verifier)
  const state = crypto.randomUUID()

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri, // must match TickTick app settings exactly
    code_challenge: challenge,
    code_challenge_method: 'S256',
    scope: SCOPE,
    state,
  })

  const authUrl = `${TICKTICK_AUTH}?${params.toString()}`
  console.log('[auth] authorize url:', authUrl)
  return { url: authUrl, verifier, state }
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
    client_id: CLIENT_ID, // proxy will enforce/override to its own
    code,
    redirect_uri: redirectUri, // must be http://127.0.0.1:8802/oauth/callback
    code_verifier: verifier,
    scope: SCOPE,
  })

  console.log('[auth] exchanging via proxy:', `${TOKEN_PROXY_URL}/oauth/token`)

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
    client_id: CLIENT_ID, // proxy will normalize
    refresh_token,
    scope: SCOPE,
  })

  console.log('[auth] refreshing via proxy:', `${TOKEN_PROXY_URL}/oauth/token`)

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
