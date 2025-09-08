import React from 'react'
import ReactDOM from 'react-dom/client'

// Extend Window interface for new mirror data APIs
declare global {
  interface Window {
    completions: {
      recent: (limit: number) => Promise<CompletionRow[]>
    }
    openTasks: {
      list: () => Promise<OpenRow[]>
    }
  }
}

type AuthStatus = 'signed_in' | 'signed_out' | 'error'

type RuleDTO = import('../../electron-main/src/rewards/types').RuleDTO

type CompletionRow = {
  task_id: string
  title: string
  tags: string[]
  project_id?: string | null
  list?: string | null
  due_ts?: number | null
  completed_ts: number
  is_recurring?: boolean
  series_key?: string | null
}

type OpenRow = {
  task_id: string
  title: string
  tags: string[]
  project_id?: string | null
  list?: string | null
  due_ts?: number | null
  created_ts?: number | null
}

function formatRuleScope(scope: RuleDTO['scope']): string {
  switch (scope.kind) {
    case 'tag':
      return `tag: ${scope.value}`
    case 'list':
      return `list: ${scope.value}`
    case 'project':
      return `project: ${scope.value}`
    case 'title_regex':
      return `title: ${scope.value}`
    case 'weekday':
      const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ]
      return `weekday: ${dayNames[scope.value] || scope.value}`
    case 'time_range':
      return `time: ${scope.value.startHour}-${scope.value.endHour}`
    case 'deadline':
      if (scope.value === 'has_deadline') return 'deadline: has deadline'
      if (scope.value === 'overdue') return 'deadline: overdue'
      return `deadline: within ${scope.value.withinHours}h`
    default:
      return JSON.stringify(scope)
  }
}

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
  create(rule: Omit<RuleDTO, 'id'>): Promise<{ id: number }>
  update(
    id: string,
    patch: Partial<Omit<RuleDTO, 'id'>>,
  ): Promise<{ id: number }>
  remove(id: string): Promise<{ ok: true }>
  reorder(idsInOrder: string[]): Promise<{ ok: true }>
  getTagPriority(): Promise<string[]>
  setTagPriority(tags: string[]): Promise<{ ok: true }>
  test(mockTask: unknown): Promise<{
    pointsPrePenalty: number
    baseSource: 'override' | 'exclusive' | 'none'
    exclusiveRuleId?: string
    additiveRuleIds: string[]
    multiplierRuleIds: string[]
    additiveSum: number
    multiplierProduct: number
  }>
  onChanged(cb: (msg: unknown) => void): () => void
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
  onResult?(cb: (p: SyncStatusPayload) => void): void
}

declare global {
  interface Window {
    lootDb: {
      getBalance(): Promise<number>
      insertTest(amount?: number): Promise<string>
      debug: {
        checkTables: () => Promise<string[]>
        checkOpenTasks: () => Promise<{ count: number; sample: OpenRow[] }>
      }
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
  const [quickAddOpen, setQuickAddOpen] = React.useState(false)
  const [quickAddTitle, setQuickAddTitle] = React.useState('')
  const [quickAddMode, setQuickAddMode] = React.useState<
    'exclusive' | 'additive' | 'multiplier'
  >('additive')
  const [quickAddAmount, setQuickAddAmount] = React.useState('')
  const [quickAddScope, setQuickAddScope] = React.useState('')

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

  const insertTagScope = () => {
    setQuickAddScope('{ "kind": "tag", "value": "sample" }')
  }

  const submitQuickAdd = async () => {
    const title = quickAddTitle.trim()
    const amountStr = quickAddAmount.trim()
    const scopeStr = quickAddScope.trim()

    if (!title || !amountStr || !scopeStr) {
      alert('Please fill in all fields')
      return
    }

    const amount = parseFloat(amountStr)
    if (isNaN(amount)) {
      alert('Amount must be a valid number')
      return
    }

    // Validation based on mode
    if (quickAddMode === 'multiplier' && amount <= 0) {
      alert('Multiplier must be > 0')
      return
    }

    let scope: RuleDTO['scope']
    try {
      scope = JSON.parse(scopeStr)
    } catch {
      alert('Invalid JSON in Scope field')
      return
    }

    setBusy(true)
    try {
      const maxPriority = rules
        ? Math.max(...rules.map((r) => r.priority), 0)
        : 0
      const newRule: RuleDTO = {
        id: 'rule-' + Date.now().toString(36),
        enabled: true,
        priority: maxPriority + 1,
        mode: quickAddMode,
        amount: amount,
        scope: scope,
      }

      // Use the upsert method if available, otherwise fall back to create
      if (
        typeof (
          window.rules as unknown as {
            upsert?: (rule: RuleDTO) => Promise<{ id: number }>
          }
        ).upsert === 'function'
      ) {
        await (
          window.rules as unknown as {
            upsert: (rule: RuleDTO) => Promise<{ id: number }>
          }
        ).upsert(newRule)
      } else if (typeof window.rules.create === 'function') {
        await window.rules.create({
          enabled: newRule.enabled,
          mode: newRule.mode,
          amount: newRule.amount,
          scope: newRule.scope,
          priority: newRule.priority,
        })
      } else {
        throw new Error('No rules.create or rules.upsert found on window.rules')
      }

      // Reset form
      setQuickAddTitle('')
      setQuickAddAmount('')
      setQuickAddScope('')
      setQuickAddOpen(false)
      await refresh()
    } catch (err) {
      console.error('Failed to create quick rule:', err)
      alert(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
      <h2 style={{ marginTop: 0 }}>Rules</h2>
      {/* Quick Add Section */}
      <div
        style={{
          marginBottom: 16,
          border: '1px solid #eee',
          borderRadius: 8,
          padding: 12,
          backgroundColor: '#fafafa',
        }}
      >
        <h3
          style={{
            marginTop: 0,
            marginBottom: 12,
            fontSize: '14px',
            fontWeight: 'bold',
          }}
        >
          Quick Add
        </h3>
        {!quickAddOpen ? (
          <button
            onClick={() => setQuickAddOpen(true)}
            disabled={busy}
            style={{ padding: '6px 10px', borderRadius: 8 }}
          >
            + Quick Add Rule
          </button>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
              }}
            >
              <input
                autoFocus
                placeholder="Title"
                value={quickAddTitle}
                onChange={(e) => setQuickAddTitle(e.currentTarget.value)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid #ccc',
                }}
              />
              <select
                value={quickAddMode}
                onChange={(e) =>
                  setQuickAddMode(
                    e.currentTarget.value as
                      | 'exclusive'
                      | 'additive'
                      | 'multiplier',
                  )
                }
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid #ccc',
                }}
              >
                <option value="exclusive">Exclusive</option>
                <option value="additive">Additive</option>
                <option value="multiplier">Multiplier</option>
              </select>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 8,
              }}
            >
              <input
                type="number"
                step="any"
                placeholder="Amount"
                value={quickAddAmount}
                onChange={(e) => setQuickAddAmount(e.currentTarget.value)}
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid #ccc',
                }}
              />
              <button
                onClick={insertTagScope}
                style={{
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1px solid #ccc',
                  backgroundColor: '#f0f0f0',
                  fontSize: '12px',
                }}
              >
                Insert tag scope
              </button>
            </div>
            <textarea
              placeholder='Scope JSON (e.g., { "kind": "tag", "value": "fitness" })'
              value={quickAddScope}
              onChange={(e) => setQuickAddScope(e.currentTarget.value)}
              rows={3}
              style={{
                padding: '6px 8px',
                borderRadius: 8,
                border: '1px solid #ccc',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '12px',
                resize: 'vertical',
              }}
            />
            <div
              style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}
            >
              <button
                onClick={submitQuickAdd}
                disabled={
                  busy ||
                  !quickAddTitle.trim() ||
                  !quickAddAmount.trim() ||
                  !quickAddScope.trim()
                }
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  backgroundColor: '#007bff',
                  color: 'white',
                  border: 'none',
                }}
              >
                Add Rule
              </button>
              <button
                onClick={() => {
                  setQuickAddOpen(false)
                  setQuickAddTitle('')
                  setQuickAddAmount('')
                  setQuickAddScope('')
                }}
                style={{
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid #ccc',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
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
              <span
                style={{
                  width: 84,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <span
                  style={{
                    padding: '2px 6px',
                    borderRadius: 4,
                    fontSize: '10px',
                    fontWeight: 'bold',
                    backgroundColor:
                      r.mode === 'exclusive'
                        ? '#ff6b6b'
                        : r.mode === 'additive'
                          ? '#4ecdc4'
                          : '#45b7d1',
                    color: 'white',
                    textTransform: 'uppercase',
                  }}
                >
                  {r.mode === 'exclusive'
                    ? '[EXCLUSIVE]'
                    : r.mode === 'additive'
                      ? '[ADD]'
                      : '[×]'}
                </span>
              </span>
              <code style={{ flex: 1, whiteSpace: 'pre-wrap' }}>
                {formatRuleScope(r.scope)} · amt={r.amount}
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

  // M3 mirror data state
  const [completions, setCompletions] = React.useState<CompletionRow[]>([])
  const [openTasks, setOpenTasks] = React.useState<OpenRow[]>([])
  const [loadingCompletions, setLoadingCompletions] = React.useState(false)
  const [loadingOpenTasks, setLoadingOpenTasks] = React.useState(false)

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

  // M3 mirror data actions
  const loadCompletions = React.useCallback(async () => {
    console.log('[renderer] Loading completions...')
    setLoadingCompletions(true)
    try {
      const data = await window.completions.recent(50)
      console.info('[renderer] completions rows:', data.length)
      setCompletions(data)
    } catch (error) {
      console.error('Failed to load completions:', error)
    } finally {
      setLoadingCompletions(false)
    }
  }, [])

  const loadOpenTasks = React.useCallback(async () => {
    console.log('[renderer] Loading open tasks...')
    setLoadingOpenTasks(true)
    try {
      const data = await window.openTasks.list()
      console.info('[renderer] open rows received:', data.length, 'items')
      setOpenTasks(data)
    } catch (error) {
      console.error('Failed to load open tasks:', error)
      // Show user-friendly error message
      alert(
        `Failed to load open tasks: ${error instanceof Error ? error.message : String(error)}`,
      )
    } finally {
      setLoadingOpenTasks(false)
    }
  }, [])

  // Initial load
  React.useEffect(() => {
    void refreshBalance()
    void refreshAuthAndSyncStatus()
    void loadCompletions()
    void loadOpenTasks()
  }, [refreshBalance, refreshAuthAndSyncStatus, loadCompletions, loadOpenTasks])

  // Refresh mirror data after successful sync
  React.useEffect(() => {
    if (lastSync && Number(lastSync) > 0) {
      void loadCompletions()
      void loadOpenTasks()
    }
  }, [lastSync, loadCompletions, loadOpenTasks])

  // Subscribe to sync result push from main (updates Last Sync + balance immediately)
  React.useEffect(() => {
    if (typeof window.sync.onResult === 'function') {
      const handler = (p: SyncStatusPayload) => {
        console.log('[renderer] sync result via IPC:', p)
        if (p.ok && typeof p.at === 'number') {
          setLastSync(String(p.at))
          void refreshBalance()
        }
      }
      window.sync.onResult(handler)
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

      {/* M3 mirror data panels */}
      <section
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Recent Completions</h2>
        {loadingCompletions ? (
          <p>Loading completions...</p>
        ) : completions.length === 0 ? (
          <p>No recent completions found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '14px',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5' }}>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Title
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Tags
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Due
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Completed
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Project
                  </th>
                </tr>
              </thead>
              <tbody>
                {completions.map((completion) => (
                  <tr key={`${completion.task_id}-${completion.completed_ts}`}>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {completion.title}
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {completion.tags.join(', ') || '—'}
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {completion.due_ts
                        ? new Date(completion.due_ts).toLocaleDateString()
                        : '—'}
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {new Date(completion.completed_ts).toLocaleString()}
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {completion.project_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <button
            onClick={loadCompletions}
            disabled={loadingCompletions}
            style={{ padding: '8px 12px', borderRadius: 8 }}
          >
            {loadingCompletions ? 'Loading...' : 'Refresh Completions'}
          </button>
          <button
            onClick={async () => {
              try {
                const tables =
                  (await window.lootDb.debug?.checkTables?.()) ||
                  'Not available'
                console.log('Available tables:', tables)
                alert(
                  `Available tables: ${Array.isArray(tables) ? tables.join(', ') : tables}`,
                )
              } catch (error) {
                console.error('Debug check failed:', error)
                alert('Debug check failed: ' + error)
              }
            }}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              backgroundColor: '#f0f0f0',
            }}
          >
            Debug Tables
          </button>
        </div>
      </section>

      <section
        style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 12,
          marginBottom: 16,
        }}
      >
        <h2 style={{ marginTop: 0 }}>Open Tasks</h2>
        {loadingOpenTasks ? (
          <p>Loading open tasks...</p>
        ) : openTasks.length === 0 ? (
          <p>No open tasks found.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                fontSize: '14px',
              }}
            >
              <thead>
                <tr style={{ backgroundColor: '#f5f5f5' }}>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Title
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Tags
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Due
                  </th>
                  <th
                    style={{
                      padding: '8px',
                      textAlign: 'left',
                      border: '1px solid #ddd',
                    }}
                  >
                    Project
                  </th>
                </tr>
              </thead>
              <tbody>
                {openTasks.map((task) => (
                  <tr key={task.task_id}>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {task.title}
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {task.tags.join(', ') || '—'}
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {task.due_ts
                        ? new Date(task.due_ts).toLocaleDateString()
                        : '—'}
                    </td>
                    <td style={{ padding: '8px', border: '1px solid #ddd' }}>
                      {task.project_id || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button
          onClick={loadOpenTasks}
          disabled={loadingOpenTasks}
          style={{ padding: '8px 12px', borderRadius: 8, marginTop: 8 }}
        >
          {loadingOpenTasks ? 'Loading...' : 'Refresh Open Tasks'}
        </button>
        <button
          onClick={async () => {
            try {
              const result = await window.lootDb.debug.checkOpenTasks()
              console.log('Debug open_tasks:', result)
              alert(
                `Open tasks count: ${result.count}\nSample: ${JSON.stringify(result.sample, null, 2)}`,
              )
            } catch (error) {
              console.error('Debug error:', error)
              alert(`Debug error: ${error}`)
            }
          }}
          style={{
            padding: '8px 12px',
            borderRadius: 8,
            marginTop: 8,
            marginLeft: 8,
          }}
        >
          Debug Open Tasks
        </button>
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
