// packages/electron-main/src/auth/index.ts
import { shell } from 'electron'
import { startLoopbackServer } from './loopback'
import { buildAuthUrl, exchangeCode, refreshToken } from './ticktick'
import { saveTokens, loadTokens, clearTokens } from './keychain'
import { getState, setState } from '../db/queries'

const ACCOUNT = 'ticktick'
const LOOPBACK_PORT = Number(process.env.OAUTH_LOOPBACK_PORT ?? '8802') // must match TickTick redirect
let inFlight = false

export async function startAuthFlow(): Promise<void> {
  if (inFlight) return
  inFlight = true

  const oauth: { verifier?: string; redirectUri?: string } = {}

  try {
    // start loopback on a FIXED port so it matches the registered redirect URI
    const { server, port } = await startLoopbackServer(
      async (code /*, state? */) => {
        try {
          if (!oauth.verifier || !oauth.redirectUri) {
            throw new Error('OAuth verifier/redirectUri not ready')
          }
          const tokens = await exchangeCode({
            code,
            redirectUri: oauth.redirectUri,
            verifier: oauth.verifier,
          })
          const expires_at = Date.now() + tokens.expires_in * 1000 - 60_000 // refresh 1m early

          await saveTokens(ACCOUNT, {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at,
          })
          setState('auth_status', 'signed_in')
        } catch (e) {
          setState('auth_status', 'error')
          throw e
        } finally {
          server.close()
          inFlight = false
        }
      },
      LOOPBACK_PORT,
    )

    // build the exact redirect URI that’s registered in TickTick
    oauth.redirectUri = `http://127.0.0.1:${port}/oauth/callback`

    const { url, verifier } = await buildAuthUrl(oauth.redirectUri)
    oauth.verifier = verifier

    await shell.openExternal(url)
  } catch (err) {
    // if starting the loopback or building the URL fails, release the lock
    inFlight = false
    throw err
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const t = await loadTokens(ACCOUNT)
  if (!t) return null
  if (Date.now() < t.expires_at) return t.access_token

  const r = await refreshToken({ refresh_token: t.refresh_token })
  const expires_at = Date.now() + r.expires_in * 1000 - 60_000

  const next = {
    access_token: r.access_token,
    refresh_token: r.refresh_token ?? t.refresh_token,
    expires_at,
  }
  await saveTokens(ACCOUNT, next)
  return next.access_token
}

export function logout(): void {
  clearTokens(ACCOUNT)
  setState('auth_status', 'signed_out')
}

export function authStatus(): 'signed_in' | 'signed_out' | 'error' {
  const s = getState('auth_status')
  if (s === 'signed_in' || s === 'error') return s
  return 'signed_out'
}
