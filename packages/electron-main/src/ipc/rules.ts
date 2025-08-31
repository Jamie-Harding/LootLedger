// packages/electron-main/src/ipc/rules.ts
import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron'
import {
  listRules,
  upsertRule,
  deleteRule,
  getTagPriority,
  setTagPriority,
  type UpsertRuleInput,
  type RuleRow,
} from '../db/queries'
import * as RulesModule from '../sync/rules'

// ---- Types for the tester ----
type RuleTestContext = {
  id?: string
  title: string
  tags: string[]
  list?: string
  projectId?: string
  completedAt: number // ms since epoch
  dueAt?: number | null // ms or null
  weekday: number // 0..6
  timeOfDayMin: number // minutes from midnight
}

type EvalBreakdown = {
  base: number
  exclusiveRuleId?: number
  additiveRuleIds: number[]
  multiplierRuleIds: number[]
  subtotalBeforeMult: number
  productMultiplier: number
  finalRounded: number
}

type EvalFn = (
  ctx: RuleTestContext,
  rules: RuleRow[],
  tagOrder: string[],
) => EvalBreakdown

// Resolve evaluator regardless of export shape/name
function resolveEvaluator(mod: typeof RulesModule): EvalFn {
  const m = mod as unknown as {
    evaluateTask?: EvalFn
    evaluate?: EvalFn
    default?: { evaluateTask?: EvalFn; evaluate?: EvalFn }
  }
  if (m.evaluateTask) return m.evaluateTask
  if (m.evaluate) return m.evaluate
  if (m.default?.evaluateTask) return m.default.evaluateTask
  if (m.default?.evaluate) return m.default.evaluate
  throw new Error(
    'rules evaluator not found (expected evaluateTask or evaluate)',
  )
}

// Broadcast rules change to all windows
function broadcastRulesChanged(payload: unknown) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('rules:changed', payload)
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
      const evalFn = resolveEvaluator(RulesModule)
      const rules = listRules()
      const tagOrder = getTagPriority()
      return evalFn(ctx, rules, tagOrder)
    },
  )
}
