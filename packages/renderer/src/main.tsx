import React from 'react'
import ReactDOM from 'react-dom/client'

function App() {
  return (
    <div style={{ padding: 16 }}>
      <h1>Loot Ledger — Renderer</h1>
      <p>If you can see this inside the Electron window, Vite is working.</p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
