import React from 'react'

declare global {
  interface Window {
    lootDb: {
      getBalance(): Promise<number>
      insertTest(amount?: number): Promise<string>
    }
  }
}

export default function M1TestPanel() {
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
    <div className="p-4 rounded-2xl shadow">
      <div className="text-xl font-semibold mb-2">M1 — Test Panel</div>
      <div className="mb-3">
        Current balance: <b>{balance ?? '...'}</b>
      </div>
      <button
        className="px-3 py-2 rounded-xl bg-black text-white"
        onClick={add}
      >
        Insert +1 test transaction
      </button>
    </div>
  )
}
