import React from 'react'
import ReactDOM from 'react-dom/client'

declare global {
  interface Window {
    lootDb: {
      getBalance(): Promise<number>
      insertTest(amount?: number): Promise<string>
    }
  }
}

function App() {
  const [balance, setBalance] = React.useState<number | null>(null)
  const refresh = async () => setBalance(await window.lootDb.getBalance())

  React.useEffect(() => {
    refresh()
  }, [])

  const add = async () => {
    await window.lootDb.insertTest(1)
    await refresh()
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Loot Ledger — M1 Test Panel</h1>
      <p>
        Current balance: <b>{balance ?? '...'}</b>
      </p>
      <button onClick={add} style={{ padding: '8px 12px', borderRadius: 8 }}>
        Insert +1 test transaction
      </button>
      <p style={{ marginTop: 12, opacity: 0.7 }}>
        Quit & relaunch the app — the balance should persist (SQLite).
      </p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
