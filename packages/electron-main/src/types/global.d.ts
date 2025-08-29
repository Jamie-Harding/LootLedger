declare global {
  interface Window {
    oauth: {
      start(): Promise<void>
      status(): Promise<'signed_in' | 'signed_out' | 'error'>
      logout(): Promise<void>
    }
    sync: {
      now(): Promise<{ ok: boolean }>
      getStatus(): Promise<{ lastSyncAt: string | null }>
    }
  }
}
export {}
