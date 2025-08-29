import { shell } from 'electron'
import { startLoopbackServer } from './loopback'
import { buildAuthUrl, exchangeCode, refreshToken } from './ticktick'
import { saveTokens, loadTokens, clearTokens } from './keychain'
import { setState, getState } from '../db/queries'

const ACCOUNT = 'ticktick'
let inFlight = false

export async function startAuthFlow(db) {
  if (inFlight) return
  inFlight = true
  try {
    const { server, port } = await startLoopbackServer(async (code, state) => {
      try {
        const tokens = await exchangeCode({ code, redirectUri, verifier })
        const expires_at = Date.now() + tokens.expires_in * 1000 - 60 * 1000
        await saveTokens(ACCOUNT, {
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          expires_at,
        })
        await setState(db, 'auth_status', 'signed_in')
      } catch (e) {
        await setState(db, 'auth_status', 'error')
      } finally {
        server.close()
        inFlight = false
      }
    })

    const redirectUri = `http://127.0.0.1:${port}/oauth/callback`
    const { url, verifier } = await buildAuthUrl(redirectUri)
    await shell.openExternal(url)
  } catch (e) {
    inFlight = false
    await setState(db, 'auth_status', 'error')
    throw e
  }
}

export async function getValidAccessToken(): Promise<string | null> {
  const t = await loadTokens(ACCOUNT)
  if (!t) return null
  if (Date.now() < t.expires_at) return t.access_token

  // refresh
  const r = await refreshToken({ refresh_token: t.refresh_token })
  const expires_at = Date.now() + r.expires_in * 1000 - 60 * 1000
  const next = {
    access_token: r.access_token,
    refresh_token: r.refresh_token ?? t.refresh_token,
    expires_at,
  }
  await saveTokens(ACCOUNT, next)
  return next.access_token
}

export async function logout(db) {
  await clearTokens(ACCOUNT)
  await setState(db, 'auth_status', 'signed_out')
}

export async function authStatus(db) {
  const s = await getState(db, 'auth_status')
  return s ?? 'signed_out'
}
