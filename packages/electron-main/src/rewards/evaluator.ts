import type {
  EvalBreakdown,
  TaskContext,
  RuleDTO,
  DeadlineValue,
} from './types'
export type { EvalBreakdown, TaskContext, DeadlineValue } from './types' // keep same exported names

// Example rule.shape assumption (keep your existing Rule type, this is illustrative)

export type Rule = {
  id: string
  enabled: boolean
  mode: 'exclusive' | 'additive' | 'multiplier'
  scope:
    | { kind: 'tag'; value: string }
    | { kind: 'list'; value: string }
    | { kind: 'project'; value: string }
    | { kind: 'title_regex'; value: string }
    | { kind: 'weekday'; value: number } // 0–6
    | { kind: 'time_range'; value: { startHour: number; endHour: number } } // 0-23
    | { kind: 'deadline'; value: DeadlineValue }
  amount: number
  priority: number
}

// --- HELPERS (NEW)
function matchesDeadline(value: DeadlineValue, t: TaskContext): boolean {
  if (!t.dueAt) return value === 'has_deadline' ? false : false
  switch (typeof value) {
    case 'string':
      if (value === 'has_deadline') return !!t.dueAt
      if (value === 'overdue') return t.dueAt < t.completedAt
      return false
    default:
      // object: withinHours
      if (
        typeof value.withinHours === 'number' &&
        Number.isFinite(value.withinHours)
      ) {
        // require completedAt <= dueAt and (dueAt - completedAt) <= N * 3600_000
        const diffMs = t.dueAt - t.completedAt
        const windowMs = value.withinHours * 3600_000
        return diffMs >= 0 && diffMs <= windowMs
      }
      return false
  }
}

// existing matches() -> add a case for 'deadline'
function matches(rule: Rule, t: TaskContext): boolean {
  if (!rule.enabled) return false
  const s = rule.scope
  switch (s.kind) {
    case 'tag':
      return t.tags.includes(s.value)
    case 'list':
      return t.list === s.value
    case 'project':
      return t.project === s.value
    case 'title_regex': {
      // Support inline (?i) case-insensitive prefix
      const rx = new RegExp(s.value)
      return rx.test(t.title)
    }
    case 'weekday': {
      const wd = new Date(t.completedAt).getDay()
      return wd === s.value
    }
    case 'time_range': {
      // interpret time_range against completedAt local time
      const d = new Date(t.completedAt)
      const hh = d.getHours()
      const startHour = s.value.startHour
      const endHour = s.value.endHour
      // handle wrap-around ranges like 22→6
      return startHour <= endHour
        ? hh >= startHour && hh <= endHour
        : hh >= startHour || hh <= endHour
    }
    case 'deadline': // NEW
      return matchesDeadline(s.value, t)
  }
}

// --- OPTIONAL: override stub to be filled in M6
function findOverrideBase(): /* { base?: number; source?: 'override' } | */ undefined {
  return undefined
}

// --- MAIN EVALUATION (return spec shape)
export function evaluateTask(
  t: TaskContext,
  rules: Rule[],
  tagPriority: string[],
): EvalBreakdown {
  // 1) overrides (stub → none)
  const override = findOverrideBase()

  let baseSource: EvalBreakdown['baseSource'] = 'none'
  let base = 0
  let exclusiveRuleId: string | undefined
  const additiveRuleIds: string[] = []
  const multiplierRuleIds: string[] = []

  if (override) {
    base = /* override.base */ 0
    baseSource = 'override'
  } else {
    // 2) exclusive by tag priority
    const exclusives = rules.filter(
      (r) => r.mode === 'exclusive' && matches(r, t),
    )
    if (exclusives.length) {
      // determine highest priority by tag order, then rule.priority, then stable tie-breaker
      exclusives.sort((a, b) => {
        // First: tag priority (lower index wins)
        const atag = a.scope.kind === 'tag' ? a.scope.value : ''
        const btag = b.scope.kind === 'tag' ? b.scope.value : ''
        const ai = tagPriority.indexOf(atag)
        const bi = tagPriority.indexOf(btag)

        // If neither tag is in priority list, treat as +∞ (equal rank)
        if (ai === -1 && bi === -1) {
          // Second: rule.priority (ascending)
          if (a.priority !== b.priority) return a.priority - b.priority
          // Third: stable tie-breaker by id
          return a.id.localeCompare(b.id)
        }

        // If only one tag is in priority list, the one in the list wins
        if (ai === -1) return 1
        if (bi === -1) return -1

        // Both tags are in priority list, compare by index
        if (ai !== bi) return ai - bi

        // Same tag priority, use rule.priority
        if (a.priority !== b.priority) return a.priority - b.priority

        // Final tie-breaker: stable by id
        return a.id.localeCompare(b.id)
      })
      const win = exclusives[0]
      base = win.amount
      baseSource = 'exclusive'
      exclusiveRuleId = win.id
    }
  }

  // 3) additives
  let additiveSum = 0
  for (const r of rules) {
    if (r.mode !== 'additive') continue
    if (!matches(r, t)) continue
    additiveSum += r.amount
    additiveRuleIds.push(r.id)
  }

  // 4) multipliers
  let multiplierProduct = 1
  for (const r of rules) {
    if (r.mode !== 'multiplier') continue
    if (!matches(r, t)) continue
    multiplierProduct *= r.amount
    multiplierRuleIds.push(r.id)
  }

  // 5) round once at the end
  // For exclusive rules, return exactly the exclusive amount, ignoring additives and multipliers
  const pointsPrePenalty =
    baseSource === 'exclusive'
      ? Math.round(base)
      : Math.round((base + additiveSum) * multiplierProduct)

  return {
    pointsPrePenalty,
    baseSource,
    exclusiveRuleId,
    additiveRuleIds,
    multiplierRuleIds,
    additiveSum,
    multiplierProduct,
  }
}
