import { contextBridge, ipcRenderer } from 'electron'

console.log('[preload] loaded')

contextBridge.exposeInMainWorld('lootDb', {
  getBalance: () => ipcRenderer.invoke('db:getBalance') as Promise<number>,
  insertTest: (amount?: number) =>
    ipcRenderer.invoke('db:insertTest', amount) as Promise<string>,
  onStatusChanged(cb: (status: string) => void) {
    ipcRenderer.on('auth:statusChanged', (_, s) => cb(s))
  },
})

contextBridge.exposeInMainWorld('oauth', {
  start: () => ipcRenderer.invoke('auth:start'),
  status: () => ipcRenderer.invoke('auth:status'),
  logout: () => ipcRenderer.invoke('auth:logout'),
})
contextBridge.exposeInMainWorld('sync', {
  now: () => ipcRenderer.invoke('sync:now'),
  getStatus: () => ipcRenderer.invoke('sync:getStatus'),
})

contextBridge.exposeInMainWorld('sync', {
  now: () => ipcRenderer.invoke('sync:now'),
  getStatus: () => ipcRenderer.invoke('sync:getStatus'),
  onStatus: (
    cb: (p: {
      ok: boolean
      at?: number
      added?: number
      error?: string
    }) => void,
  ) => {
    ipcRenderer.on('sync:status', (_evt, payload) => cb(payload))
  },
})
