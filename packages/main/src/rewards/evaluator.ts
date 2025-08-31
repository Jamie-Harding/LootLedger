export type RuleType = 'exclusive' | 'additive' | 'multiplier'

export interface Rule {
  id: number
  priority: number // lower wins for exclusives
  type: RuleType
  scope: 'tag' | 'list' | 'title_regex' | 'project' | 'weekday' | 'time_range'
  matchValue: string // e.g. "#study" or "^read:.*"
  amount: number // points or factor (for multiplier)
  enabled: boolean
}

export interface TaskContext {
  id: string
  title: string
  tags: string[] // TickTick tags
  list?: string
  projectId?: string
  completedAt: number // ms
  dueAt?: number | null // ms | null (M5 uses this)
  weekday: number // 0-6, local tz
  timeOfDayMin: number // minutes from midnight
}

export interface EvalBreakdown {
  base: number
  exclusiveRuleId?: number
  additiveRuleIds: number[]
  multiplierRuleIds: number[]
  subtotalBeforeMult: number
  productMultiplier: number
  finalRounded: number
}

/** Select the single exclusive using tag priority, else highest-priority rule id. */
function pickExclusive(
  ctx: TaskContext,
  exclusives: Rule[],
  tagOrder: string[],
): Rule | undefined {
  // If any exclusive is tag-scoped, use tagOrder to break ties.
  const tagScoped = exclusives.filter(
    (r) => r.scope === 'tag' && ctx.tags.includes(r.matchValue),
  )
  if (tagScoped.length) {
    const rank = (tag: string) => {
      const i = tagOrder.indexOf(tag)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    // choose exclusive with the *best* (lowest) tag rank; tie-breaker on priority then rule id
    return tagScoped.sort((a, b) => {
      const ra = rank(a.matchValue),
        rb = rank(b.matchValue)
      if (ra !== rb) return ra - rb
      if (a.priority !== b.priority) return a.priority - b.priority
      return a.id - b.id
    })[0]
  }
  // fallback: lowest priority wins among all exclusives that match
  return exclusives.sort((a, b) => a.priority - b.priority || a.id - b.id)[0]
}

function matches(ctx: TaskContext, r: Rule): boolean {
  switch (r.scope) {
    case 'tag':
      return ctx.tags.includes(r.matchValue)
    case 'list':
      return (ctx.list ?? '') === r.matchValue
    case 'project':
      return (ctx.projectId ?? '') === r.matchValue
    case 'weekday':
      return String(ctx.weekday) === r.matchValue
    case 'time_range': {
      // matchValue like "HH:MM-HH:MM" in local time
      const [a, b] = r.matchValue.split('-')
      const toMin = (s: string) => {
        const [H, M] = s.split(':').map(Number)
        return H * 60 + (M || 0)
      }
      const start = toMin(a),
        end = toMin(b)
      const t = ctx.timeOfDayMin
      return start <= end ? t >= start && t < end : t >= start || t < end // handle overnight
    }
    case 'title_regex':
      return new RegExp(r.matchValue, 'i').test(ctx.title)
    default:
      return false
  }
}

export function evaluateTask(
  ctx: TaskContext,
  rules: Rule[],
  tagPriority: string[],
): EvalBreakdown {
  const enabled = rules.filter((r) => r.enabled && matches(ctx, r))

  const exclusives = enabled.filter((r) => r.type === 'exclusive')
  const additives = enabled.filter((r) => r.type === 'additive')
  const mults = enabled.filter((r) => r.type === 'multiplier')

  const exclusive = exclusives.length
    ? pickExclusive(ctx, exclusives, tagPriority)
    : undefined
  const base = exclusive ? exclusive.amount : 0

  const addSum = additives.reduce((s, r) => s + r.amount, 0)
  const subtotal = base + addSum

  const product = mults.reduce((p, r) => p * r.amount, 1)

  // M4 stops here (no penalties/early bonus yet)
  const final = Math.round(subtotal * product)

  return {
    base,
    exclusiveRuleId: exclusive?.id,
    additiveRuleIds: additives.map((r) => r.id),
    multiplierRuleIds: mults.map((r) => r.id),
    subtotalBeforeMult: subtotal,
    productMultiplier: product,
    finalRounded: final,
  }
}
