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

type RuleDTO = {
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
}

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
  project?: string
  completedAt: number // ms since epoch
  dueAt?: number | null // ms or null
}

export type EvalBreakdown = {
  pointsPrePenalty: number
  baseSource: 'override' | 'exclusive' | 'none'
  exclusiveRuleId?: string
  additiveRuleIds: string[]
  multiplierRuleIds: string[]
  additiveSum: number
  multiplierProduct: number
}

export type RulesChangedMessage =
  | { id: number; deleted?: boolean }
  | { tagPriority: true }

/* ---------- Preload-safe Rules API ---------- */
const rulesAPI = {
  // already had:
  list(): Promise<RuleDTO[]> {
    return ipcRenderer.invoke('rules:list')
  },

  // 🔧 FIXED: map DTO -> Upsert payload
  create(rule: Omit<RuleDTO, 'id'>): Promise<{ id: number }> {
    const payload = dtoToUpsert(rule)
    console.log('[preload] rules.create -> upsert payload:', payload)
    return ipcRenderer.invoke('rules:upsert', payload)
  },

  update(
    id: string,
    patch: Partial<Omit<RuleDTO, 'id'>>,
  ): Promise<{ id: number }> {
    const payload = dtoToUpsert({ id, ...patch })
    console.log('[preload] rules.update -> upsert payload:', payload)
    return ipcRenderer.invoke('rules:upsert', payload)
  },

  remove(id: string): Promise<{ ok: true }> {
    return ipcRenderer.invoke('rules:delete', Number(id))
  },

  // if you haven’t added this yet, it’s harmless to keep:
  reorder(idsInOrder: string[]): Promise<{ ok: true }> {
    return ipcRenderer.invoke(
      'rules:reorder',
      idsInOrder.map((s) => Number(s)),
    )
  },

  getTagPriority(): Promise<string[]> {
    return ipcRenderer.invoke('rules:getTagPriority')
  },
  setTagPriority(tags: string[]): Promise<{ ok: true }> {
    return ipcRenderer.invoke('rules:setTagPriority', tags)
  },

  test(mockTask: unknown) {
    return ipcRenderer.invoke('rules:test', mockTask)
  },

  onChanged(cb: (msg: unknown) => void) {
    const handler = (_e: IpcRendererEvent, payload: unknown) => cb(payload)
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
  now: () =>
    ipcRenderer.invoke('sync:now') as Promise<{
      lastSyncAt: number | null
      error: string | null
      polling: boolean
      pollSeconds: number
      backoffMs: number
      nextRunInMs: number
    }>,
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

// Helper: map renderer RuleDTO (or patch of it) -> DB UpsertRulePayload
function dtoToUpsert(
  input: Partial<RuleDTO> & { id?: string; priority?: number },
): UpsertRulePayload {
  // figure out scope and matchValue
  let scope: UpsertRulePayload['scope'] = 'title_regex'
  let matchValue = ''
  if (input.scope) {
    const k = input.scope.kind
    scope =
      k === 'tag' ||
      k === 'list' ||
      k === 'project' ||
      k === 'title_regex' ||
      k === 'weekday' ||
      k === 'time_range'
        ? k
        : 'title_regex'
    if (k === 'time_range') {
      matchValue = JSON.stringify(
        (
          input.scope as {
            kind: 'time_range'
            value: { start: string; end: string }
          }
        ).value,
      )
    } else {
      matchValue = String(
        (input.scope as { kind: string; value: string | number }).value ?? '',
      )
    }
  }

  return {
    id: input.id ? Number(input.id) : undefined,
    priority: typeof input.priority === 'number' ? input.priority : Date.now(),
    type: (input.mode ?? 'additive') as UpsertRulePayload['type'],
    scope,
    matchValue,
    amount: typeof input.amount === 'number' ? input.amount : 1,
    enabled: input.enabled ?? true,
  }
}
