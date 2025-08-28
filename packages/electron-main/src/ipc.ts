import { ipcMain } from 'electron'
import { getBalance, insertTestTransaction } from './db/queries'

export function registerDbIpc() {
  ipcMain.handle('db:getBalance', () => getBalance())
  ipcMain.handle('db:insertTest', (_e, amount?: number) =>
    insertTestTransaction(amount ?? 1),
  )
}
