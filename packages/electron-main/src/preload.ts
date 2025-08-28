import { contextBridge, ipcRenderer } from 'electron'

console.log('[preload] loaded')

contextBridge.exposeInMainWorld('lootDb', {
  getBalance: () => ipcRenderer.invoke('db:getBalance') as Promise<number>,
  insertTest: (amount?: number) =>
    ipcRenderer.invoke('db:insertTest', amount) as Promise<string>,
})
