// at top of ipc.ts (with your other imports)
import { ipcMain, BrowserWindow } from 'electron'
import {
  listRules,
  upsertRule,
  deleteRule,
  getTagPriority,
  setTagPriority,
  type UpsertRuleInput,
  type RuleRow,
} from './db/queries'
import * as RulesModule from './sync/rules'

// ----- Types for the tester -----
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

// The evaluator signature we expect
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

// ---- Rules CRUD ----
ipcMain.handle('rules:list', () => listRules())

ipcMain.handle('rules:upsert', (_e, payload: UpsertRuleInput) => {
  const id = upsertRule(payload)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('rules:changed', { id })
  }
  return { id }
})

ipcMain.handle('rules:delete', (_e, id: number) => {
  deleteRule(id)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('rules:changed', { id, deleted: true })
  }
  return { ok: true }
})

// ---- Tag priority ----
ipcMain.handle('rules:getTagPriority', () => getTagPriority())

ipcMain.handle('rules:setTagPriority', (_e, tags: string[]) => {
  setTagPriority(tags)
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('rules:changed', { tagPriority: true })
  }
  return { ok: true }
})

// ---- Rule tester ----
ipcMain.handle('rules:test', (_e, ctx: RuleTestContext) => {
  const evalFn = resolveEvaluator(RulesModule)
  const rules = listRules()
  const tagOrder = getTagPriority()
  return evalFn(ctx, rules, tagOrder)
})
