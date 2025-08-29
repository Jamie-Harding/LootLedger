import { contextBridge, ipcRenderer } from 'electron'

console.log('[preload] loaded')

contextBridge.exposeInMainWorld('lootDb', {
  getBalance: () => ipcRenderer.invoke('db:getBalance') as Promise<number>,
  insertTest: (amount?: number) =>
    ipcRenderer.invoke('db:insertTest', amount) as Promise<string>,
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
