export type SyncState = {
  lastSyncAt: number
  backoffMs: number
  enabled: boolean
}

export function nextBackoff(prev: number) {
  const cap = 10 * 60_000 // 10 min
  return Math.min(cap, Math.max(1000, prev ? prev * 2 : 5000))
}
