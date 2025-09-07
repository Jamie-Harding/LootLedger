// packages/electron-main/src/sync/ticktickClient.ts

type RawTask = {
  id: string
  title: string
  projectId: string
  tags?: string[]
  dueDate?: string | null
  completedTime?: string | null
  status?: number // 2 = completed in many TickTick payloads
  repeatFlag?: string | null
  seriesId?: string | null
  deleted?: 0 | 1
}

type Project = { id: string; name: string }

type ProjectData = {
  tasks?: RawTask[]
  completedTasks?: RawTask[]
  // allow unknown extra fields without using `any`
  [k: string]: unknown
}

export type TickCompletedItem = {
  id: string
  title: string
  tags: string[]
  list?: string | null
  project?: string | null
  dueAt?: number | null // epoch ms (nullable)
  completedAt: number // epoch ms
  isRecurring?: boolean
  seriesKey?: string | null
}

export type TickOpenItem = {
  id: string
  title: string
  tags: string[]
  list?: string | null
  project?: string | null
  dueAt?: number | null
  createdAt?: number | null
}

// Discriminated union item expected by downstream code
export type TickTickChange = TickCompletedItem & { type: 'completed' }

const BASE = 'https://api.ticktick.com/open/v1'

// Minimal fetch typing so we don't rely on DOM lib types in Electron main
type FetchResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}
type FetchInit = { headers?: Record<string, string> }
type FetchFn = (input: string, init?: FetchInit) => Promise<FetchResponse>

export class TickTickClient {
  constructor(
    private token: string,
    private _fetch?: FetchFn,
  ) {}

  private headers() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    }
  }

  private get fetcher(): FetchFn {
    // Use injected fetch if provided (handy for tests), else global
    const f =
      this._fetch ?? (globalThis as unknown as { fetch?: FetchFn }).fetch
    if (!f) throw new Error('No fetch implementation available')
    return f
  }

  /** Quick probe to confirm the token is valid */
  async me(): Promise<unknown> {
    const res = await this.fetcher(`${BASE}/user`, { headers: this.headers() })
    if (!res.ok) throw new Error(`ticktick /user ${res.status}`)
    return res.json()
  }

  private async getJson<T>(url: string): Promise<T> {
    const res = await this.fetcher(url, { headers: this.headers() })
    if (!res.ok) throw new Error(`ticktick ${url} ${res.status}`)
    return res.json() as Promise<T>
  }

  private async listProjects(): Promise<Project[]> {
    return this.getJson<Project[]>(`${BASE}/project`)
  }

  private async getProjectData(projectId: string): Promise<ProjectData> {
    return this.getJson<ProjectData>(`${BASE}/project/${projectId}/data`)
  }

  /**
   * Return completed changes whose completedAt > sinceMs.
   * We fetch each project's data and filter locally for status==2 and completedTime > since.
   */
  async listChanges(sinceMs: number): Promise<TickTickChange[]> {
    const since =
      Number.isFinite(sinceMs) && sinceMs > 0
        ? sinceMs
        : Date.now() - 7 * 24 * 60 * 60 * 1000

    const projects = await this.listProjects()

    const items: TickCompletedItem[] = []
    for (const p of projects) {
      try {
        const data = await this.getProjectData(p.id)

        // Some payloads expose everything under `tasks`; others may split.
        const candidateLists: RawTask[][] = []
        if (Array.isArray(data.tasks)) candidateLists.push(data.tasks)
        if (Array.isArray(data.completedTasks))
          candidateLists.push(data.completedTasks)

        for (const list of candidateLists) {
          for (const t of list) {
            if (!t || t.deleted) continue
            const status = typeof t.status === 'number' ? t.status : undefined
            const completedStr = t.completedTime ?? null
            const completedAt = completedStr ? Date.parse(completedStr) : NaN
            if (
              status === 2 &&
              Number.isFinite(completedAt) &&
              completedAt > since
            ) {
              items.push({
                id: t.id,
                title: t.title ?? '',
                tags: Array.isArray(t.tags) ? t.tags : [],
                list: null, // TickTick doesn't expose list info in this API
                project: p.name,
                dueAt: t.dueDate ? Date.parse(t.dueDate) : null,
                completedAt,
                isRecurring: !!(t.repeatFlag && t.repeatFlag !== ''),
                seriesKey: t.seriesId ?? null,
              })
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        // Non-fatal per project; continue others

        console.warn('[ticktick] project fetch failed', p.id, msg)
      }
    }

    // Sort by completion time just to be predictable
    items.sort((a, b) => a.completedAt - b.completedAt)

    // Adapt to the discriminated type the caller expects
    const changes: TickTickChange[] = items.map((i) => ({
      type: 'completed',
      ...i,
    }))
    return changes
  }

  /**
   * Return open/incomplete tasks from all projects.
   * We fetch each project's data and filter locally for status != 2 (not completed).
   */
  async listOpenTasks(): Promise<TickOpenItem[]> {
    const projects = await this.listProjects()

    const items: TickOpenItem[] = []
    for (const p of projects) {
      try {
        const data = await this.getProjectData(p.id)

        // Some payloads expose everything under `tasks`; others may split.
        const candidateLists: RawTask[][] = []
        if (Array.isArray(data.tasks)) candidateLists.push(data.tasks)
        if (Array.isArray(data.completedTasks))
          candidateLists.push(data.completedTasks)

        for (const list of candidateLists) {
          for (const t of list) {
            if (!t || t.deleted) continue
            const status = typeof t.status === 'number' ? t.status : undefined
            // Only include tasks that are not completed (status != 2)
            if (status !== 2) {
              items.push({
                id: t.id,
                title: t.title ?? '',
                tags: Array.isArray(t.tags) ? t.tags : [],
                list: null, // TickTick doesn't expose list info in this API
                project: p.name,
                dueAt: t.dueDate ? Date.parse(t.dueDate) : null,
                createdAt: null, // Creation time not available in current API structure
              })
            }
          }
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        // Non-fatal per project; continue others
        console.warn('[ticktick] project fetch failed', p.id, msg)
      }
    }

    // Sort by creation time for consistency
    items.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))

    return items
  }
}

// --- Adapters expected by sync/index.ts ---------------------------
import { getValidAccessToken } from '../auth'

type TickTickItemForSync = {
  id: string
  title?: string
  tags?: string[]
  projectId?: string
  due?: number | { ts?: number | null } | null
  completedTime?: number
  isRecurring?: boolean
  seriesKey?: string | null
}

function toSyncItem(x: TickCompletedItem): TickTickItemForSync {
  return {
    id: x.id,
    title: x.title,
    tags: x.tags,
    projectId: x.project ?? undefined,
    due: x.dueAt ?? null,
    completedTime: x.completedAt,
    isRecurring: x.isRecurring,
    seriesKey: x.seriesKey,
  }
}

export async function listCompletedTasksSince(
  sinceIso: string,
): Promise<TickCompletedItem[]> {
  const sinceMs = Number.isFinite(Date.parse(sinceIso))
    ? Date.parse(sinceIso)
    : 0

  const token = await getValidAccessToken() // likely string | null
  if (!token) {
    throw new Error('ticktickClient: no access token (not signed in)')
  }

  const client = new TickTickClient(token)
  const changes = await client.listChanges(sinceMs) // TickCompletedItem[]
  return changes.map((change) => ({
    id: change.id,
    title: change.title,
    tags: change.tags,
    list: change.list,
    project: change.project,
    dueAt: change.dueAt,
    completedAt: change.completedAt,
    isRecurring: change.isRecurring,
    seriesKey: change.seriesKey,
  }))
}

// Alias so sync/index.ts can find either name
export const listChanges = listCompletedTasksSince

export async function listOpenTasks(): Promise<TickOpenItem[]> {
  const token = await getValidAccessToken() // likely string | null
  if (!token) {
    throw new Error('ticktickClient: no access token (not signed in)')
  }

  const client = new TickTickClient(token)
  return client.listOpenTasks()
}
