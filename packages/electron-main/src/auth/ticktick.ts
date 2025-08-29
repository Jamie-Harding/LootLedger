// packages/electron-main/src/auth/ticktick.ts
import crypto from 'node:crypto'
import { generateVerifier, challengeFromVerifier } from './pkce'

// TODO: confirm these endpoints with TickTick's OAuth docs.
export const TICKTICK_AUTH = 'https://ticktick.com/oauth/authorize'
export const TICKTICK_TOKEN = 'https://ticktick.com/oauth/token'

// Public client: safe to ship. Prefer env first, fallback to a literal for dev.
export const CLIENT_ID =
  process.env.TICKTICK_CLIENT_ID ??
  process.env.VITE_TICKTICK_CLIENT_ID ??
  '1987QO8z862eqOITJq' // <-- replace this with your real client_id

// Scopes: use whatever TickTick expects, space-separated if multiple.
export const SCOPE = 'tasks:read tasks:write' // <-- adjust if needed

export type AuthStartResult = { url: string; verifier: string; state: string }

export async function buildAuthUrl(
  redirectUri: string,
): Promise<AuthStartResult> {
  if (!CLIENT_ID || CLIENT_ID === '1987QO8z862eqOITJq') {
    throw new Error(
      'CLIENT_ID is not set. Configure TICKTICK_CLIENT_ID env or replace the placeholder.',
    )
  }

  const verifier = generateVerifier()
  const challenge = await challengeFromVerifier(verifier)
  const state = crypto.randomUUID()

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri, // e.g., http://127.0.0.1:PORT/oauth/callback
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
  if (!res.ok) throw new Error(`token exchange failed ${res.status}`)
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
  if (!res.ok) throw new Error(`refresh failed ${res.status}`)
  return res.json() as Promise<{
    access_token: string
    refresh_token?: string
    expires_in: number
  }>
}
