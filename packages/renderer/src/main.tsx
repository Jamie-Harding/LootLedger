import React from 'react'
import ReactDOM from 'react-dom/client'

declare global {
  interface Window {
    lootDb: {
      getBalance(): Promise<number>
      insertTest(amount?: number): Promise<string>
    }
    oauth: {
      start(): Promise<void>
      status(): Promise<'signed_in' | 'signed_out' | 'error'>
      logout(): Promise<void>
    }
    sync: {
      now(): Promise<{
        ok: boolean
        skipped?: boolean
        added?: number
        reason?: string
      }>
      getStatus(): Promise<{ lastSyncAt: string | null }>
    }
  }
}

function App() {
  // M1 state
  const [balance, setBalance] = React.useState<number | null>(null)

  // M2 state
  const [authStatus, setAuthStatus] = React.useState<
    'signed_in' | 'signed_out' | 'error'
  >('signed_out')
  const [lastSync, setLastSync] = React.useState<string | null>(null)
  const [syncBusy, setSyncBusy] = React.useState(false)

  // M1 actions
  const refreshBalance = React.useCallback(async () => {
    setBalance(await window.lootDb.getBalance())
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
      await refreshBalance() // in case sync added transactions
    } finally {
      setSyncBusy(false)
    }
  }, [refreshAuthAndSyncStatus, refreshBalance])

  React.useEffect(() => {
    refreshBalance()
    refreshAuthAndSyncStatus()
  }, [refreshBalance, refreshAuthAndSyncStatus])

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
