// preload.ts
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('lootDb', {
  getBalance: () => ipcRenderer.invoke('db:getBalance'),
  insertTest: (amount?: number) => ipcRenderer.invoke('db:insertTest', amount),
})

contextBridge.exposeInMainWorld('oauth', {
  start: () => ipcRenderer.invoke('auth:start'),
  status: () => ipcRenderer.invoke('auth:status'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  // ⬇ NEW: auth status push
  onStatusChanged: (cb: (s: 'signed_in' | 'signed_out' | 'error') => void) => {
    ipcRenderer.on('auth:statusChanged', (_evt, s) => cb(s))
  },
})

contextBridge.exposeInMainWorld('sync', {
  now: () => ipcRenderer.invoke('sync:now'),
  getStatus: () => ipcRenderer.invoke('sync:getStatus'),
  // ⬇ NEW: sync status push
  onStatus: (
    cb: (
      p: { ok: true; at: number; added: number } | { ok: false; error: string },
    ) => void,
  ) => {
    ipcRenderer.on('sync:status', (_evt, payload) => cb(payload))
  },
})
