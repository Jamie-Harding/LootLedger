import React from 'react'
import ReactDOM from 'react-dom/client'

type AuthStatus = 'signed_in' | 'signed_out' | 'error'

type RuleDTO = {
  id: string
  enabled: boolean
  mode: 'exclusive' | 'additive' | 'multiplier'
  scope:
    | { kind: 'tag'; value: string }
    | { kind: 'list'; value: string }
    | { kind: 'project'; value: string }
    | { kind: 'title_regex'; value: string }
    | { kind: 'weekday'; value: number }
    | { kind: 'time_range'; value: { start: string; end: string } }
    | { kind: 'deadline'; value: DeadlineValue }

  amount: number
}

type DeadlineValue = 'has_deadline' | 'overdue' | { withinHours: number }

type EvalBreakdown = {
  pointsPrePenalty: number
  baseSource: 'override' | 'exclusive' | 'none'
  exclusiveRuleId?: string
  additiveRuleIds: string[]
  multiplierRuleIds: string[]
  additiveSum: number
  multiplierProduct: number
}

type RulesAPI = {
  list(): Promise<RuleDTO[]>
  create(rule: Omit<RuleDTO, 'id'>): Promise<RuleDTO>
  update(id: string, patch: Partial<Omit<RuleDTO, 'id'>>): Promise<RuleDTO>
  remove(id: string): Promise<void>
  reorder(idsInOrder: string[]): Promise<void>
  test(mockTask: unknown): Promise<{
    pointsPrePenalty: number
    baseSource: 'override' | 'exclusive' | 'none'
    exclusiveRuleId?: string
    additiveRuleIds: string[]
    multiplierRuleIds: string[]
    additiveSum: number
    multiplierProduct: number
  }>
}

declare global {
  interface Window {
    // ... your existing lootDb/oauth/sync
    rules: RulesAPI
  }
}

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
  getStatus(): Promise<{ lastSyncAt: number | null }>
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

function RulesPanel() {
  const [rules, setRules] = React.useState<RuleDTO[] | null>(null)
  const [busy, setBusy] = React.useState(false)

  const refresh = React.useCallback(async () => {
    setRules(await window.rules.list())
  }, [])

  React.useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = async (r: RuleDTO) => {
    setBusy(true)
    try {
      await window.rules.update(r.id, { enabled: !r.enabled })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const del = async (id: string) => {
    if (!confirm('Delete rule?')) return
    setBusy(true)
    try {
      await window.rules.remove(id)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const move = async (idx: number, dir: -1 | 1) => {
    if (!rules) return
    const j = idx + dir
    if (j < 0 || j >= rules.length) return
    const arr = rules.slice()
    const [item] = arr.splice(idx, 1)
    arr.splice(j, 0, item)
    setBusy(true)
    try {
      await window.rules.reorder(arr.map((r) => r.id))
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const createQuick = async () => {
    // tiny helper to create a rule quickly for testing
    const titleRx = prompt('Title regex (e.g. "(?i)gym")')
    if (!titleRx) return
    setBusy(true)
    try {
      await window.rules.create({
        enabled: true,
        mode: 'additive',
        scope: { kind: 'title_regex', value: titleRx },
        amount: 1,
      })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
      <h2 style={{ marginTop: 0 }}>Rules</h2>
      <div style={{ marginBottom: 8 }}>
        <button
          onClick={createQuick}
          disabled={busy}
          style={{ padding: '6px 10px', borderRadius: 8 }}
        >
          + Quick additive (title_regex)
        </button>
      </div>
      {!rules ? (
        <p>Loading…</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {rules.map((r, i) => (
            <li
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                border: '1px solid #eee',
                borderRadius: 8,
                padding: 8,
                marginBottom: 6,
              }}
            >
              <span style={{ width: 84, opacity: 0.8 }}>{r.mode}</span>
              <code style={{ flex: 1, whiteSpace: 'pre-wrap' }}>
                {JSON.stringify(r.scope)} · amt={r.amount}
              </code>
              <button onClick={() => move(i, -1)} disabled={busy}>
                ↑
              </button>
              <button onClick={() => move(i, +1)} disabled={busy}>
                ↓
              </button>
              <button onClick={() => toggle(r)} disabled={busy}>
                {r.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => del(r.id)}
                disabled={busy}
                style={{ color: 'crimson' }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <p style={{ marginTop: 8, opacity: 0.7 }}>
        Drag is simulated via ↑/↓ for now; we’re calling{' '}
        <code>rules.reorder(ids)</code>.
      </p>
    </section>
  )
}

function RuleTester() {
  const [input, setInput] = React.useState<string>(() =>
    JSON.stringify(
      {
        id: 'mock',
        title: 'Example: gym',
        tags: ['fitness'],
        list: 'Inbox',
        project: 'Personal',
        completedAt: Date.now(),
        dueAt: Date.now() + 3600_000, // due in 1h
      },
      null,
      2,
    ),
  )
  const [out, setOut] = React.useState<EvalBreakdown | null>(null)
  const [busy, setBusy] = React.useState(false)

  const run = async () => {
    setBusy(true) // if you don't have setSyncBusy here, change to setBusy(true)
    try {
      const mock = JSON.parse(input)
      const res = await window.rules.test(mock)
      setOut(res)
    } catch (e) {
      // keep this loose if you haven't added EvalBreakdown typing yet
      const msg = e instanceof Error ? e.message : String(e)
      alert('Invalid JSON: ' + msg)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
      <h2 style={{ marginTop: 0 }}>Rule Tester</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={14}
          style={{
            width: '100%',
            fontFamily: 'ui-monospace, monospace',
            fontSize: 12,
            padding: 8,
          }}
        />
        <pre
          style={{
            margin: 0,
            background: '#fafafa',
            border: '1px solid #eee',
            borderRadius: 8,
            padding: 8,
            overflow: 'auto',
          }}
        >
          {out
            ? JSON.stringify(out, null, 2)
            : 'Run the tester to see the breakdown.'}
        </pre>
      </div>
      <div style={{ marginTop: 8 }}>
        <button
          onClick={run}
          disabled={busy}
          style={{ padding: '8px 12px', borderRadius: 8 }}
        >
          {busy ? 'Testing…' : 'Run tester'}
        </button>
      </div>
      <p style={{ marginTop: 8, opacity: 0.7 }}>
        Shows <code>pointsPrePenalty</code>, winners, and all contributing rule
        IDs.
      </p>
    </section>
  )
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
    setLastSync(ss.lastSyncAt != null ? String(ss.lastSyncAt) : null)
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
      const res = await window.sync.now()
      if (res && res.ok) {
        // Sync was successful; refresh status will update lastSync
      }
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
        console.log('[renderer] sync status via IPC:', p)
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
      {/* M4 panels (INSERTED HERE) */}
      <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
        <RulesPanel />
        <RuleTester />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
