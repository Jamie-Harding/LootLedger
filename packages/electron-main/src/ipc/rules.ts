// packages/electron-main/src/ipc/rules.ts
import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import {
  listRules,
  upsertRule,
  deleteRule,
  reorderRules,
  getTagPriority,
  setTagPriority,
  type UpsertRuleInput,
  type RuleRow,
} from '../db/queries'
import type { TaskContext } from '../rewards/types'
import { evaluateTask, type Rule } from '../rewards/evaluator'

// ---- Types for the tester ----
type RuleTestContext = {
  id?: string
  title: string
  tags: string[]
  list?: string
  project?: string
  completedAt: number // ms since epoch
  dueAt?: number | null // ms or null
}

// Broadcast rules change to all windows
function broadcastRulesChanged(payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('rules:changed', payload)
  }
}

// Convert RuleRow (DB format) to RuleDTO (renderer format)
function ruleRowToDto(row: RuleRow): {
  id: string
  enabled: boolean
  mode: 'exclusive' | 'additive' | 'multiplier'
  scope:
    | { kind: 'tag'; value: string }
    | { kind: 'list'; value: string }
    | { kind: 'project'; value: string }
    | { kind: 'title_regex'; value: string }
    | { kind: 'weekday'; value: number }
    | { kind: 'time_range'; value: { start: string; end: string } }
  amount: number
} {
  let scope:
    | { kind: 'tag'; value: string }
    | { kind: 'list'; value: string }
    | { kind: 'project'; value: string }
    | { kind: 'title_regex'; value: string }
    | { kind: 'weekday'; value: number }
    | { kind: 'time_range'; value: { start: string; end: string } }
  switch (row.scope) {
    case 'tag':
      scope = { kind: 'tag', value: row.matchValue }
      break
    case 'list':
      scope = { kind: 'list', value: row.matchValue }
      break
    case 'project':
      scope = { kind: 'project', value: row.matchValue }
      break
    case 'title_regex':
      scope = { kind: 'title_regex', value: row.matchValue }
      break
    case 'weekday':
      scope = { kind: 'weekday', value: parseInt(row.matchValue) }
      break
    case 'time_range':
      scope = { kind: 'time_range', value: JSON.parse(row.matchValue) }
      break
    default:
      scope = { kind: 'title_regex', value: row.matchValue }
  }

  return {
    id: String(row.id),
    enabled: row.enabled,
    mode: row.type,
    scope,
    amount: row.amount,
  }
}

// Call this from your main ipc bootstrap
export function registerRulesIpc(): void {
  // CRUD
  ipcMain.handle('rules:list', () => listRules())

  ipcMain.handle(
    'rules:upsert',
    (_e: IpcMainInvokeEvent, payload: UpsertRuleInput) => {
      const id = upsertRule(payload)
      broadcastRulesChanged({ id })
      return { id }
    },
  )

  ipcMain.handle('rules:delete', (_e: IpcMainInvokeEvent, id: number) => {
    deleteRule(id)
    broadcastRulesChanged({ id, deleted: true })
    return { ok: true }
  })

  ipcMain.handle(
    'rules:reorder',
    (_e: IpcMainInvokeEvent, idsInOrder: number[]) => {
      reorderRules(idsInOrder)
      broadcastRulesChanged({ reordered: true })
      return { ok: true }
    },
  )

  // Tag priority (canonical channels)
  ipcMain.handle('rules:getTagPriority', () => getTagPriority())
  ipcMain.handle(
    'rules:setTagPriority',
    (_e: IpcMainInvokeEvent, arr: string[]) => {
      setTagPriority(arr)
      broadcastRulesChanged({ tagPriority: true })
      return { ok: true }
    },
  )

  // Optional aliases if your renderer already calls settings:* (keeps both working)
  ipcMain.handle('settings:getTagPriority', () => getTagPriority())
  ipcMain.handle(
    'settings:setTagPriority',
    (_e: IpcMainInvokeEvent, arr: string[]) => {
      setTagPriority(arr)
      broadcastRulesChanged({ tagPriority: true })
      return { ok: true }
    },
  )

  // Tester
  ipcMain.handle(
    'rules:test',
    (_e: IpcMainInvokeEvent, ctx: RuleTestContext) => {
      const mock: TaskContext = {
        id: ctx.id || 'test',
        title: ctx.title,
        tags: ctx.tags,
        list: ctx.list || null,
        project: ctx.project || null,
        completedAt: ctx.completedAt,
        dueAt: ctx.dueAt || null,
      }
      const rules: Rule[] = listRules()
      const order = getTagPriority()
      const res = evaluateTask(mock, rules, order)
      return res
    },
  )
}
