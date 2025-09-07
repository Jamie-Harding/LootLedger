// packages/electron-main/src/sync/ticktickClient.ts

import { parseTickTickDate } from './ticktickDate'

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

/**
 * Minimal task shape the sync loop relies on. Status is strict:
 * 0=open, 1=not used here, 2=completed.
 */
export interface TickTask {
  id: string
  title: string
  status: 0 | 1 | 2
  completedTime?: string | null
  dueDate?: string | null
  startDate?: string | null
  tags?: string[]
  projectId?: string | null
  isAllDay?: boolean
  etag?: string | null
  sortOrder?: number | null
  updatedTime?: string | null
}

export interface TickProject {
  id: string
  name: string
}

/** Access token carrier; wire it to your existing auth. */
export type TickTickAuth = { accessToken: string }

export async function listProjects(auth: TickTickAuth): Promise<TickProject[]> {
  // Replace URL with the exact Open API route you're already using; common pattern is /open/v1/project
  const url = new URL('https://api.ticktick.com/open/v1/project')

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(
      '[ticktick][projects] HTTP',
      res.status,
      res.statusText,
      'body=',
      body.slice(0, 300),
    )
    throw new Error(`HTTP_${res.status}`)
  }

  const json = (await res.json()) as unknown
  if (!Array.isArray(json)) {
    console.error('[ticktick][projects] non-array JSON')
    return []
  }

  // Minimal, strict mapping
  const items: TickProject[] = []
  for (const raw of json as Array<Record<string, unknown>>) {
    const id = typeof raw.id === 'string' ? raw.id : null
    const name = typeof raw.name === 'string' ? raw.name : null
    if (id && name) items.push({ id, name })
  }

  if (process.env.SYNC_TRACE === '1') {
    console.info('[ticktick][projects] count=', items.length)
  }
  return items
}

// Discriminated union item expected by downstream code
export type TickTickChange = TickCompletedItem & { type: 'completed' }

type Raw = Record<string, unknown>

function mapRawTask(raw: Raw): TickTask {
  return {
    id: String(raw.id),
    title: String(raw.title),
    status: Number(raw.status) as 0 | 1 | 2,
    completedTime:
      typeof raw.completedTime === 'string' ? raw.completedTime : null,
    dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : null,
    startDate: typeof raw.startDate === 'string' ? raw.startDate : null,
    tags: Array.isArray(raw.tags) ? (raw.tags as unknown[]).map(String) : [],
    projectId: raw.projectId == null ? null : String(raw.projectId),
    isAllDay: Boolean(raw.isAllDay ?? false),
    etag: typeof raw.etag === 'string' ? raw.etag : null,
    sortOrder: typeof raw.sortOrder === 'number' ? raw.sortOrder : null,
    updatedTime:
      typeof (raw as { updatedTime?: unknown }).updatedTime === 'string'
        ? String((raw as { updatedTime: string }).updatedTime)
        : null,
  }
}

async function httpJson(url: URL, auth: TickTickAuth): Promise<unknown> {
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(
      '[ticktick][HTTP]',
      res.status,
      res.statusText,
      'url=',
      url.toString(),
      'body=',
      body.slice(0, 300),
    )
    const err = new Error(`HTTP_${res.status}`)
    ;(err as { status?: number }).status = res.status
    throw err
  }
  return res.json()
}

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

  private async getCompletedTasks(): Promise<RawTask[]> {
    try {
      console.log('[ticktick] Trying global completed tasks endpoint...')
      const response = await this.getJson<{ tasks?: RawTask[] }>(
        `${BASE}/task/completed`,
      )
      console.log(
        '[ticktick] Global completed tasks response keys:',
        Object.keys(response),
      )
      console.log(
        '[ticktick] Global completed tasks response:',
        JSON.stringify(response, null, 2),
      )
      return response.tasks || []
    } catch (error) {
      console.log('[ticktick] Global completed tasks endpoint failed:', error)
      return []
    }
  }

  private async getCompletedTasksFromProject(
    projectId: string,
    since: number,
  ): Promise<TickCompletedItem[]> {
    try {
      console.log(
        '[ticktick] Trying project completed tasks endpoint for project:',
        projectId,
      )
      const response = await this.getJson<{ tasks?: RawTask[] }>(
        `${BASE}/project/${projectId}/completed`,
      )
      console.log(
        '[ticktick] Project completed tasks response keys:',
        Object.keys(response),
      )
      console.log(
        '[ticktick] Project completed tasks response:',
        JSON.stringify(response, null, 2),
      )

      const tasks = response.tasks || []
      const items: TickCompletedItem[] = []

      for (const t of tasks) {
        if (!t || t.deleted) continue
        const completedAt = parseTickTickDate(t.completedTime)

        console.log(
          '[ticktick] Project completed task:',
          t.title,
          'completedAt:',
          completedAt,
          'since:',
          since,
        )

        if (
          completedAt != null &&
          Number.isFinite(completedAt) &&
          completedAt > since
        ) {
          console.log(
            '[ticktick] Found completed task from project endpoint:',
            t.title,
            'completedAt:',
            completedAt,
          )
          items.push({
            id: t.id,
            title: t.title ?? '',
            tags: Array.isArray(t.tags) ? t.tags : [],
            list: null,
            project: projectId,
            dueAt: parseTickTickDate(t.dueDate),
            completedAt,
            isRecurring: Boolean(t.repeatFlag),
            seriesKey: t.seriesId ?? null,
          })
        }
      }

      return items
    } catch (error) {
      console.log(
        '[ticktick] Project completed tasks endpoint failed for project',
        projectId,
        ':',
        error,
      )
      return []
    }
  }

  /**
   * Return completed changes whose completedAt > sinceMs.
   * Since TickTick API doesn't provide completed tasks reliably, we detect completions
   * by tracking task disappearances from the open tasks list.
   */
  async listChanges(sinceMs: number): Promise<TickTickChange[]> {
    const since =
      Number.isFinite(sinceMs) && sinceMs > 0
        ? sinceMs
        : Date.now() - 7 * 24 * 60 * 60 * 1000

    console.log(
      '[ticktick] listChanges called with sinceMs:',
      sinceMs,
      'since:',
      since,
    )

    const allItems: TickCompletedItem[] = []

    // Try to fetch completed tasks from global endpoint first
    console.log('[ticktick] About to call getCompletedTasks()...')
    const completedTasks = await this.getCompletedTasks()
    console.log(
      '[ticktick] getCompletedTasks() returned:',
      completedTasks.length,
      'tasks',
    )

    // Process global completed tasks
    for (const t of completedTasks) {
      if (!t || t.deleted) continue
      const completedAt = parseTickTickDate(t.completedTime)

      console.log(
        '[ticktick] Global completed task:',
        t.title,
        'completedAt:',
        completedAt,
        'since:',
        since,
      )

      // For global endpoint, we trust that all returned tasks are completed
      if (
        completedAt != null &&
        Number.isFinite(completedAt) &&
        completedAt > since
      ) {
        console.log(
          '[ticktick] Found completed task from global endpoint:',
          t.title,
          'completedAt:',
          completedAt,
        )
        allItems.push({
          id: t.id,
          title: t.title ?? '',
          tags: Array.isArray(t.tags) ? t.tags : [],
          list: null,
          project: null, // We'll need to look up project name separately
          dueAt: parseTickTickDate(t.dueDate),
          completedAt,
          isRecurring: Boolean(t.repeatFlag),
          seriesKey: t.seriesId ?? null,
        })
      }
    }

    // Try project-specific completed endpoints
    console.log('[ticktick] Trying project-specific completed endpoints...')
    const projects = await this.listProjects()
    console.log('[ticktick] Found projects:', projects.length)

    for (const p of projects) {
      try {
        console.log(
          '[ticktick] Processing project completed tasks:',
          p.name,
          p.id,
        )
        const projectCompletedItems = await this.getCompletedTasksFromProject(
          p.id,
          since,
        )
        console.log(
          '[ticktick] Found',
          projectCompletedItems.length,
          'completed tasks from project',
          p.name,
        )

        // Add project name to items
        for (const item of projectCompletedItems) {
          item.project = p.name
          allItems.push(item)
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e)
        console.warn(
          '[ticktick] project completed tasks fetch failed',
          p.id,
          msg,
        )
      }
    }

    // Fall back to project data approach (looking for status=2 or completedTime)
    console.log('[ticktick] Falling back to project data approach...')
    for (const p of projects) {
      try {
        console.log('[ticktick] Processing project data:', p.name, p.id)
        const data = await this.getProjectData(p.id)
        console.log('[ticktick] Raw project data keys:', Object.keys(data))
        if (data.completedTasks) {
          console.log(
            '[ticktick] completedTasks sample:',
            JSON.stringify(data.completedTasks[0], null, 2),
          )
        }

        // Some payloads expose everything under `tasks`; others may split.
        const candidateLists: RawTask[][] = []
        if (Array.isArray(data.tasks)) {
          candidateLists.push(data.tasks)
          console.log(
            '[ticktick] Found',
            data.tasks.length,
            'tasks in project',
            p.name,
          )
        }
        if (Array.isArray(data.completedTasks)) {
          candidateLists.push(data.completedTasks)
          console.log(
            '[ticktick] Found',
            data.completedTasks.length,
            'completedTasks in project',
            p.name,
          )
        }

        for (const list of candidateLists) {
          for (const t of list) {
            if (!t || t.deleted) continue

            // Check if we already have this task
            const taskExists = allItems.some((item) => item.id === t.id)
            if (taskExists) continue

            const status = typeof t.status === 'number' ? t.status : undefined
            const completedAt = parseTickTickDate(t.completedTime)

            console.log(
              '[ticktick] Task:',
              t.title,
              'status:',
              status,
              'completedAt:',
              completedAt,
              'since:',
              since,
            )
            console.log('[ticktick] Task raw data:', JSON.stringify(t, null, 2))

            // Accept tasks with status=2 OR with a valid completedTime (some APIs might not set status correctly)
            if (
              (status === 2 ||
                (completedAt != null && Number.isFinite(completedAt))) &&
              completedAt != null &&
              Number.isFinite(completedAt) &&
              completedAt > since
            ) {
              console.log(
                '[ticktick] Found completed task from project data:',
                t.title,
                'completedAt:',
                completedAt,
              )
              allItems.push({
                id: t.id,
                title: t.title ?? '',
                tags: Array.isArray(t.tags) ? t.tags : [],
                list: null, // TickTick doesn't expose list info in this API
                project: p.name,
                dueAt: parseTickTickDate(t.dueDate),
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
        console.warn('[ticktick] project data fetch failed', p.id, msg)
      }
    }

    // Remove duplicates by task ID
    const uniqueItems = allItems.filter(
      (item, index, arr) =>
        arr.findIndex((other) => other.id === item.id) === index,
    )

    // Sort by completion time just to be predictable
    uniqueItems.sort((a, b) => a.completedAt - b.completedAt)

    console.log(
      '[ticktick] Total unique completed tasks found:',
      uniqueItems.length,
    )

    // Adapt to the discriminated type the caller expects
    const changes: TickTickChange[] = uniqueItems.map((i) => ({
      type: 'completed',
      ...i,
    }))
    return changes
  }

  /**
   * NEW: Track task disappearances to detect completions.
   * This method compares the current open tasks with previously stored open tasks
   * to find tasks that have disappeared (likely completed).
   */
  async detectCompletionsByDisappearance(): Promise<TickCompletedItem[]> {
    console.log('[ticktick] Detecting completions by task disappearance...')

    try {
      // Get current open tasks
      const currentOpenTasks = await this.listOpenTasks()
      console.log('[ticktick] Current open tasks:', currentOpenTasks.length)

      const completions: TickCompletedItem[] = []

      // For now, we'll return empty array since we need to implement task tracking
      // This would require storing previous task states and comparing them
      console.log(
        '[ticktick] Task disappearance detection not yet implemented - would need state persistence',
      )

      return completions
    } catch (error) {
      console.warn(
        '[ticktick] Failed to detect completions by disappearance:',
        error,
      )
      return []
    }
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
                dueAt: parseTickTickDate(t.dueDate),
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

// type TickTickItemForSync = {
//   id: string
//   title?: string
//   tags?: string[]
//   projectId?: string
//   due?: number | { ts?: number | null } | null
//   completedTime?: number
//   isRecurring?: boolean
//   seriesKey?: string | null
// }

export async function listCompletedTasksSince(
  sinceIso: string,
): Promise<TickCompletedItem[]> {
  const sinceMs = parseTickTickDate(sinceIso) ?? 0

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

/**
 * Fetch COMPLETED items updated between `sinceIso` and `untilIso`.
 * Keep this isolated so we can swap the underlying endpoint later without touching the sync loop.
 * IMPORTANT: This function MUST return items with status=2 and `completedTime` populated where available.
 */
export async function listCompletedSince(
  auth: TickTickAuth,
  sinceIso: string,
  untilIso: string = new Date().toISOString(),
  limit: number = 800,
): Promise<TickTask[]> {
  // If you already have an official Open API method that returns completions since a timestamp,
  // replace the block below with that call. Keep the return shape unchanged.

  const url = new URL(
    'https://api.ticktick.com/api/v2/project/all/completedInAll',
  )
  url.searchParams.set('from', sinceIso)
  url.searchParams.set('to', untilIso)
  url.searchParams.set('limit', String(limit))

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  })
  if (!res.ok) {
    throw new Error(
      `listCompletedSince failed: ${res.status} ${res.statusText}`,
    )
  }

  // Map only the fields we need, strictly typed.
  const data = (await res.json()) as Array<Record<string, unknown>>

  return data.map(
    (raw): TickTask => ({
      id: String(raw.id),
      title: String(raw.title),
      status: 2, // this endpoint returns completed items
      completedTime:
        typeof raw.completedTime === 'string' ? raw.completedTime : null,
      dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : null,
      tags: Array.isArray(raw.tags) ? (raw.tags as unknown[]).map(String) : [],
      projectId: raw.projectId == null ? null : String(raw.projectId),
      isAllDay: Boolean(raw.isAllDay ?? false),
    }),
  )
}

/**
 * Fetch OPEN (status=0) tasks you want to mirror into the "open_tasks" table.
 * Uses the working Open API v1 approach by fetching each project's data.
 */
export async function listOpenTasks(
  auth: TickTickAuth,
  limitPerPage: number = 200,
): Promise<TickTask[]> {
  const items: TickTask[] = []

  // Get all projects first
  const projects = await listProjects(auth)
  console.log('[ticktick] Found projects:', projects.length)

  // Fetch tasks from each project
  for (const project of projects) {
    try {
      console.log(`[ticktick] Fetching tasks from project: ${project.name}`)

      // Use the working Open API v1 endpoint for project data
      const url = new URL(
        `https://api.ticktick.com/open/v1/project/${encodeURIComponent(project.id)}/data`,
      )

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      })

      if (!res.ok) {
        console.warn(
          `[ticktick] Project ${project.name} data endpoint failed: ${res.status}`,
        )
        continue
      }

      const data = (await res.json()) as Record<string, unknown>

      // Extract tasks from the project data
      const tasks = data.tasks as Array<Record<string, unknown>> | undefined
      if (!Array.isArray(tasks)) {
        console.log(
          `[ticktick] No tasks array found in project ${project.name}`,
        )
        continue
      }

      console.log(
        `[ticktick] Project ${project.name} has ${tasks.length} total tasks`,
      )

      // Map and filter for open tasks (status !== 2)
      const openTasks = tasks.map(mapRawTask).filter((t) => t.status !== 2) // Filter out completed tasks

      console.log(
        `[ticktick] Project ${project.name} has ${openTasks.length} open tasks`,
      )

      for (const task of openTasks) {
        items.push(task)
      }
    } catch (error) {
      console.warn(
        `[ticktick] Failed to get tasks from project ${project.name}:`,
        error,
      )
      // Continue with other projects even if one fails
    }
  }

  console.log(`[ticktick] Total open tasks found: ${items.length}`)
  return items
}

/**
 * Fetch one task by project & task id via Open API.
 * Returns:
 *  - { ok: true, task } on 200
 *  - { ok: false, status } on non-200 (e.g., 404 if not found/moved)
 */
export async function getTaskByProjectAndId(
  auth: TickTickAuth,
  projectId: string,
  taskId: string,
): Promise<{ ok: true; task: TickTask } | { ok: false; status: number }> {
  const url = new URL(
    `https://api.ticktick.com/open/v1/project/${encodeURIComponent(projectId)}/task/${encodeURIComponent(taskId)}`,
  )
  try {
    const json = await httpJson(url, auth)
    const raw = json as Raw
    const task = mapRawTask(raw)
    return { ok: true, task }
  } catch (e) {
    const status =
      typeof (e as { status?: number }).status === 'number'
        ? (e as { status: number }).status
        : 500
    return { ok: false, status }
  }
}

export async function listOpenTasksLegacy(): Promise<TickOpenItem[]> {
  const token = await getValidAccessToken() // likely string | null
  if (!token) {
    throw new Error('ticktickClient: no access token (not signed in)')
  }

  const client = new TickTickClient(token)
  return client.listOpenTasks()
}
