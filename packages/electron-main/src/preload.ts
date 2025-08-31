// packages/electron-main/src/preload.ts
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

/* ---------- Shared types for the Rules API ---------- */
type RuleType = 'exclusive' | 'additive' | 'multiplier'
type RuleScope =
  | 'tag'
  | 'list'
  | 'title_regex'
  | 'project'
  | 'weekday'
  | 'time_range'

export type RuleRow = {
  id: number
  priority: number
  type: RuleType
  scope: RuleScope
  matchValue: string
  amount: number // points for exclusive/additive; factor for multiplier
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export type UpsertRulePayload = {
  id?: number
  priority: number
  type: RuleType
  scope: RuleScope
  matchValue: string
  amount: number
  enabled: boolean
}

export type RuleTestContext = {
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

export type EvalBreakdown = {
  base: number
  exclusiveRuleId?: number
  additiveRuleIds: number[]
  multiplierRuleIds: number[]
  subtotalBeforeMult: number
  productMultiplier: number
  finalRounded: number
}

export type RulesChangedMessage =
  | { id: number; deleted?: boolean }
  | { tagPriority: true }

/* ---------- Preload-safe Rules API ---------- */
const rulesAPI = {
  // CRUD
  list(): Promise<RuleRow[]> {
    return ipcRenderer.invoke('rules:list')
  },
  upsert(payload: UpsertRulePayload): Promise<{ id: number }> {
    return ipcRenderer.invoke('rules:upsert', payload)
  },
  remove(id: number): Promise<{ ok: true }> {
    return ipcRenderer.invoke('rules:delete', id)
  },

  // Tag priority
  getTagPriority(): Promise<string[]> {
    return ipcRenderer.invoke('rules:getTagPriority')
  },
  setTagPriority(tags: string[]): Promise<{ ok: true }> {
    return ipcRenderer.invoke('rules:setTagPriority', tags)
  },

  // Tester
  test(ctx: RuleTestContext): Promise<EvalBreakdown> {
    return ipcRenderer.invoke('rules:test', ctx)
  },

  // Events
  onChanged(cb: (msg: RulesChangedMessage) => void): () => void {
    const handler = (_e: IpcRendererEvent, payload: unknown) => {
      if (payload && typeof payload === 'object') {
        cb(payload as RulesChangedMessage)
      }
    }
    ipcRenderer.on('rules:changed', handler)
    return () => ipcRenderer.off('rules:changed', handler)
  },
}

contextBridge.exposeInMainWorld('rules', rulesAPI)

/* ---------- Existing bridges ---------- */
contextBridge.exposeInMainWorld('lootDb', {
  getBalance: () => ipcRenderer.invoke('db:getBalance'),
  insertTest: (amount?: number) => ipcRenderer.invoke('db:insertTest', amount),
})

contextBridge.exposeInMainWorld('oauth', {
  start: () => ipcRenderer.invoke('auth:start'),
  status: () => ipcRenderer.invoke('auth:status'),
  logout: () => ipcRenderer.invoke('auth:logout'),
  onStatusChanged: (cb: (s: 'signed_in' | 'signed_out' | 'error') => void) => {
    const handler = (
      _evt: IpcRendererEvent,
      s: 'signed_in' | 'signed_out' | 'error',
    ) => cb(s)
    ipcRenderer.on('auth:statusChanged', handler)
    return () => ipcRenderer.off('auth:statusChanged', handler)
  },
})

/* Optionally, mirror the SyncStatus type from main if you want */
type SyncStatus = {
  lastSyncAt: number | null
  error: string | null
  polling: boolean
  pollSeconds: number
  backoffMs: number
  nextRunInMs: number
}

contextBridge.exposeInMainWorld('sync', {
  now: () => ipcRenderer.invoke('sync:now'),
  getStatus: (): Promise<SyncStatus> => ipcRenderer.invoke('sync:getStatus'),
  getRecent: () => ipcRenderer.invoke('sync:getRecent'),

  onStatus: (cb: (s: SyncStatus) => void) => {
    const handler = (_evt: IpcRendererEvent, payload: SyncStatus) => cb(payload)
    ipcRenderer.on('sync:status', handler)
    return () => ipcRenderer.off('sync:status', handler)
  },

  onRecent: (cb: (items: unknown[]) => void) => {
    const handler = (_evt: IpcRendererEvent, items: unknown[]) => cb(items)
    ipcRenderer.on('sync:recent', handler)
    return () => ipcRenderer.off('sync:recent', handler)
  },
})
