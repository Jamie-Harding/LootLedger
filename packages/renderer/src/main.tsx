import React from 'react'
import ReactDOM from 'react-dom/client'

type AuthStatus = 'signed_in' | 'signed_out' | 'error'

type SyncOk = { ok: true; at: number; added: number }
type SyncErr = { ok: false; error: string }
type SyncStatusPayload = SyncOk | SyncErr

type SyncNowResult = {
  ok: boolean
  skipped?: boolean
  added?: number
  reason?: string
  error?: string
}

type SyncAPI = {
  now(): Promise<SyncNowResult>
  getStatus(): Promise<{ lastSyncAt: string | null }>
  onStatus?(cb: (p: SyncStatusPayload) => void): void
}

declare global {
  interface Window {
    lootDb: {
      getBalance(): Promise<number>
      insertTest(amount?: number): Promise<string>
    }
    oauth: {
      start(): Promise<void>
      status(): Promise<AuthStatus>
      logout(): Promise<void>
      onStatusChanged?(cb: (status: AuthStatus) => void): void
    }
    sync: SyncAPI
  }
}

function App() {
  // M1 state
  const [balance, setBalance] = React.useState<number | null>(null)

  // M2 state
  const [authStatus, setAuthStatus] = React.useState<AuthStatus>('signed_out')
  const [lastSync, setLastSync] = React.useState<string | null>(null)
  const [syncBusy, setSyncBusy] = React.useState(false)

  // M1 actions
  const refreshBalance = React.useCallback(async () => {
    const b = await window.lootDb.getBalance()
    setBalance(b)
  }, [])

  const addTransaction = React.useCallback(async () => {
    await window.lootDb.insertTest(1)
    await refreshBalance()
  }, [refreshBalance])

  // M2 actions
  const refreshAuthAndSyncStatus = React.useCallback(async () => {
    const s = await window.oauth.status()
    setAuthStatus(s)
    const ss = await window.sync.getStatus()
    setLastSync(ss.lastSyncAt)
  }, [])

  const connectTickTick = React.useCallback(async () => {
    await window.oauth.start()
    // optimistic; main will push status event on success/error
    await refreshAuthAndSyncStatus()
  }, [refreshAuthAndSyncStatus])

  const logoutTickTick = React.useCallback(async () => {
    await window.oauth.logout()
    await refreshAuthAndSyncStatus()
  }, [refreshAuthAndSyncStatus])

  const syncNow = React.useCallback(async () => {
    setSyncBusy(true)
    try {
      await window.sync.now()
      await refreshAuthAndSyncStatus()
      await refreshBalance()
    } finally {
      setSyncBusy(false)
    }
  }, [refreshAuthAndSyncStatus, refreshBalance])

  // Initial load
  React.useEffect(() => {
    void refreshBalance()
    void refreshAuthAndSyncStatus()
  }, [refreshBalance, refreshAuthAndSyncStatus])

  // Subscribe to sync status push from main (updates Last Sync + balance immediately)
  React.useEffect(() => {
    if (typeof window.sync.onStatus === 'function') {
      const handler = (p: SyncStatusPayload) => {
        // If you want logs, re-enable next line and ensure eslint allows console in dev.
        // console.log('[renderer] sync status via IPC:', p)
        if (p.ok && typeof p.at === 'number') {
          setLastSync(String(p.at))
          void refreshBalance()
        }
      }
      window.sync.onStatus(handler)
    }
  }, [refreshBalance])

  // Subscribe to auth status push from main (updates status immediately)
  React.useEffect(() => {
    if (typeof window.oauth.onStatusChanged === 'function') {
      const handler = (s: AuthStatus) => {
        // console.log('[renderer] auth status via IPC:', s)
        setAuthStatus(s)
      }
      window.oauth.onStatusChanged(handler)
    }
  }, [])

  return (
    <div
      style={{
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
      }}
    >
      <h1>Loot Ledger — Test Panels</h1>

      {/* M1 panel */}
      <section
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Balance</h2>
        <p>
          Current balance: <b>{balance ?? '...'}</b>
        </p>
        <button
          onClick={addTransaction}
          style={{ padding: '8px 12px', borderRadius: 8 }}
        >
          Insert +1 test transaction
        </button>
        <p style={{ marginTop: 12, opacity: 0.7 }}>
          Quit & relaunch the app — the balance should persist (SQLite).
        </p>
      </section>

      {/* M2 panel */}
      <section
        style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}
      >
        <h2 style={{ marginTop: 0 }}>TickTick</h2>
        <p>
          Status: <b>{authStatus}</b>
        </p>
        {authStatus !== 'signed_in' ? (
          <button
            onClick={connectTickTick}
            style={{ padding: '8px 12px', borderRadius: 8 }}
          >
            Connect TickTick
          </button>
        ) : (
          <button
            onClick={logoutTickTick}
            style={{ padding: '8px 12px', borderRadius: 8 }}
          >
            Logout
          </button>
        )}
        <div style={{ marginTop: 8 }}>
          <button
            onClick={syncNow}
            disabled={syncBusy || authStatus !== 'signed_in'}
            style={{ padding: '8px 12px', borderRadius: 8 }}
          >
            {syncBusy ? 'Syncing…' : 'Sync now'}
          </button>
          <p style={{ marginTop: 8 }}>
            Last sync:{' '}
            {lastSync && Number(lastSync) > 0
              ? new Date(Number(lastSync)).toLocaleString()
              : '—'}
          </p>
        </div>
      </section>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
