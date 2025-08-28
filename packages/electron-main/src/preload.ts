import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('lootDb', {
  getBalance: () => ipcRenderer.invoke('db:getBalance') as Promise<number>,
  insertTest: (amount?: number) =>
    ipcRenderer.invoke('db:insertTest', amount) as Promise<string>,
})
