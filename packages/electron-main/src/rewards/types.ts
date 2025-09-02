// packages/electron-main/src/rewards/types.ts
// Shared types for the rule evaluator & sync. Centralizing avoids drift.
// IMPORTANT: Do not change field names without migrating readers/tests.

export type RuleMode = 'exclusive' | 'additive' | 'multiplier'
export type BaseSource = 'override' | 'exclusive' | 'none'

export type DeadlineValue = 'has_deadline' | 'overdue' | { withinHours: number }

// All supported scopes (see Workflow doc §2.3 / M4)
export type RuleScope =
  | { kind: 'tag'; value: string }
  | { kind: 'list'; value: string }
  | { kind: 'project'; value: string }
  | { kind: 'title_regex'; value: string }
  | { kind: 'weekday'; value: number } // 0-6, Sunday=0
  | { kind: 'time_range'; value: { start: string; end: string } } // "HH:MM" 24h; wrap allowed
  | { kind: 'deadline'; value: DeadlineValue }

export interface RuleDTO {
  id: string
  enabled: boolean
  mode: RuleMode
  scope: RuleScope
  amount: number
}

// Minimal task context the evaluator needs for M4 (M5/M6 add penalty/override inputs)
export interface TaskContext {
  id: string
  title: string
  tags: string[]
  list?: string | null
  project?: string | null
  completedAt: number // epoch ms
  dueAt?: number | null
}

// Spec-compliant breakdown (M4 result BEFORE penalties/bonuses)
export interface EvalBreakdown {
  pointsPrePenalty: number // rounded integer
  baseSource: BaseSource // override|exclusive|none (override wired in M6)
  exclusiveRuleId?: string // present iff baseSource === 'exclusive'
  additiveRuleIds: string[] // all additive rule ids applied
  multiplierRuleIds: string[] // all multiplier rule ids applied
  additiveSum: number // raw additive sum BEFORE multipliers
  multiplierProduct: number // product of multipliers (1.0 if none)
}

// Transaction metadata shape written by sync (so renderer/ledger can explain results)
export interface TaskTransactionMetaV1 {
  kind: 'task_evaluated'
  version: 1
  breakdown: EvalBreakdown
  task: {
    id: string
    title: string
    tags: string[]
    list?: string | null
    project?: string | null
    completedAt: number
    dueAt?: number | null
  }
}
