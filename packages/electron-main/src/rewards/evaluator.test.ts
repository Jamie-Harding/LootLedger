import { describe, it, expect } from 'vitest'
import { evaluateTask, type Rule } from './evaluator'
import type { TaskContext } from './types'

describe('evaluateTask', () => {
  const createTask = (overrides: Partial<TaskContext> = {}): TaskContext => ({
    id: 'task-1',
    title: 'Test Task',
    tags: [],
    list: null,
    project: null,
    completedAt: 1700000000000, // 2023-11-14 12:00:00 UTC
    dueAt: null,
    ...overrides,
  })

  const createRule = (overrides: Partial<Rule> = {}): Rule => ({
    id: 'rule-1',
    enabled: true,
    mode: 'additive',
    scope: { kind: 'tag', value: 'test' },
    amount: 10,
    priority: 0,
    ...overrides,
  })

  describe('exclusive rules - higher priority tag wins', () => {
    it('should select higher priority tag when two exclusives match', () => {
      const task = createTask({ tags: ['urgent', 'important'] })
      const rules: Rule[] = [
        createRule({
          id: 'urgent-rule',
          mode: 'exclusive',
          scope: { kind: 'tag', value: 'urgent' },
          amount: 50,
        }),
        createRule({
          id: 'important-rule',
          mode: 'exclusive',
          scope: { kind: 'tag', value: 'important' },
          amount: 30,
        }),
      ]
      const tagPriority = ['urgent', 'important'] // urgent has higher priority

      const result = evaluateTask(task, rules, tagPriority)

      expect(result.baseSource).toBe('exclusive')
      expect(result.exclusiveRuleId).toBe('urgent-rule')
      expect(result.pointsPrePenalty).toBe(50)
    })

    it('should select higher priority tag when order is reversed in priority list', () => {
      const task = createTask({ tags: ['urgent', 'important'] })
      const rules: Rule[] = [
        createRule({
          id: 'urgent-rule',
          mode: 'exclusive',
          scope: { kind: 'tag', value: 'urgent' },
          amount: 50,
        }),
        createRule({
          id: 'important-rule',
          mode: 'exclusive',
          scope: { kind: 'tag', value: 'important' },
          amount: 30,
        }),
      ]
      const tagPriority = ['important', 'urgent'] // important has higher priority

      const result = evaluateTask(task, rules, tagPriority)

      expect(result.baseSource).toBe('exclusive')
      expect(result.exclusiveRuleId).toBe('important-rule')
      expect(result.pointsPrePenalty).toBe(30)
    })

    it('should handle exclusive rules with non-tag scopes', () => {
      const task = createTask({ list: 'work' })
      const rules: Rule[] = [
        createRule({
          id: 'work-rule',
          mode: 'exclusive',
          scope: { kind: 'list', value: 'work' },
          amount: 25,
        }),
        createRule({
          id: 'personal-rule',
          mode: 'exclusive',
          scope: { kind: 'list', value: 'personal' },
          amount: 15,
        }),
      ]
      const tagPriority: string[] = []

      const result = evaluateTask(task, rules, tagPriority)

      expect(result.baseSource).toBe('exclusive')
      expect(result.exclusiveRuleId).toBe('work-rule')
      expect(result.pointsPrePenalty).toBe(25)
    })
  })

  describe('no exclusive rules - base + additives × multipliers', () => {
    it('should calculate (0 + additives) × multipliers with single round', () => {
      const task = createTask({ tags: ['test', 'bonus'] })
      const rules: Rule[] = [
        createRule({
          id: 'additive-1',
          mode: 'additive',
          scope: { kind: 'tag', value: 'test' },
          amount: 10,
        }),
        createRule({
          id: 'additive-2',
          mode: 'additive',
          scope: { kind: 'tag', value: 'bonus' },
          amount: 5,
        }),
        createRule({
          id: 'multiplier-1',
          mode: 'multiplier',
          scope: { kind: 'tag', value: 'test' },
          amount: 2,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.baseSource).toBe('none')
      expect(result.exclusiveRuleId).toBeUndefined()
      expect(result.additiveSum).toBe(15) // 10 + 5
      expect(result.multiplierProduct).toBe(2) // 2
      expect(result.pointsPrePenalty).toBe(30) // (0 + 15) × 2 = 30
      expect(result.additiveRuleIds).toEqual(['additive-1', 'additive-2'])
      expect(result.multiplierRuleIds).toEqual(['multiplier-1'])
    })

    it('should handle multiple multipliers', () => {
      const task = createTask({ tags: ['test', 'bonus'] })
      const rules: Rule[] = [
        createRule({
          id: 'additive-1',
          mode: 'additive',
          scope: { kind: 'tag', value: 'test' },
          amount: 10,
        }),
        createRule({
          id: 'multiplier-1',
          mode: 'multiplier',
          scope: { kind: 'tag', value: 'test' },
          amount: 2,
        }),
        createRule({
          id: 'multiplier-2',
          mode: 'multiplier',
          scope: { kind: 'tag', value: 'bonus' },
          amount: 1.5,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10)
      expect(result.multiplierProduct).toBe(3) // 2 × 1.5
      expect(result.pointsPrePenalty).toBe(30) // (0 + 10) × 3 = 30
    })

    it('should round only once at the end', () => {
      const task = createTask({ tags: ['test'] })
      const rules: Rule[] = [
        createRule({
          id: 'additive-1',
          mode: 'additive',
          scope: { kind: 'tag', value: 'test' },
          amount: 10.7,
        }),
        createRule({
          id: 'multiplier-1',
          mode: 'multiplier',
          scope: { kind: 'tag', value: 'test' },
          amount: 1.3,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10.7)
      expect(result.multiplierProduct).toBe(1.3)
      expect(result.pointsPrePenalty).toBe(14) // Math.round((0 + 10.7) × 1.3) = Math.round(13.91) = 14
    })
  })

  describe('negative additives', () => {
    it('should handle negative additive that lowers points', () => {
      const task = createTask({ tags: ['test', 'penalty'] })
      const rules: Rule[] = [
        createRule({
          id: 'additive-positive',
          mode: 'additive',
          scope: { kind: 'tag', value: 'test' },
          amount: 20,
        }),
        createRule({
          id: 'additive-negative',
          mode: 'additive',
          scope: { kind: 'tag', value: 'penalty' },
          amount: -5,
        }),
        createRule({
          id: 'multiplier-1',
          mode: 'multiplier',
          scope: { kind: 'tag', value: 'test' },
          amount: 2,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(15) // 20 + (-5)
      expect(result.multiplierProduct).toBe(2)
      expect(result.pointsPrePenalty).toBe(30) // (0 + 15) × 2 = 30
    })

    it('should handle all negative additives', () => {
      const task = createTask({ tags: ['penalty1', 'penalty2'] })
      const rules: Rule[] = [
        createRule({
          id: 'additive-negative-1',
          mode: 'additive',
          scope: { kind: 'tag', value: 'penalty1' },
          amount: -10,
        }),
        createRule({
          id: 'additive-negative-2',
          mode: 'additive',
          scope: { kind: 'tag', value: 'penalty2' },
          amount: -5,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(-15) // -10 + (-5)
      expect(result.multiplierProduct).toBe(1)
      expect(result.pointsPrePenalty).toBe(-15) // (0 + (-15)) × 1 = -15
    })
  })

  describe('time_range with wrap-around', () => {
    it('should handle wrap-around time range (22:00–06:00)', () => {
      const task = createTask({ completedAt: 1700000000000 }) // 2023-11-14 12:00:00 UTC
      const rules: Rule[] = [
        createRule({
          id: 'night-rule',
          mode: 'additive',
          scope: {
            kind: 'time_range',
            value: { startHour: 22, endHour: 6 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(0) // 12:00 is not in 22:00–06:00 range
      expect(result.pointsPrePenalty).toBe(0)
    })

    it('should match time within wrap-around range (23:00)', () => {
      // Create a task completed at 23:00 local time
      const completedAt = new Date('2023-11-14T23:00:00').getTime()
      const task = createTask({ completedAt })
      const rules: Rule[] = [
        createRule({
          id: 'night-rule',
          mode: 'additive',
          scope: {
            kind: 'time_range',
            value: { startHour: 22, endHour: 6 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10) // 23:00 is in 22:00–06:00 range
      expect(result.pointsPrePenalty).toBe(10)
    })

    it('should match time within wrap-around range (02:00)', () => {
      // Create a task completed at 02:00 local time
      const completedAt = new Date('2023-11-14T02:00:00').getTime()
      const task = createTask({ completedAt })
      const rules: Rule[] = [
        createRule({
          id: 'night-rule',
          mode: 'additive',
          scope: {
            kind: 'time_range',
            value: { startHour: 22, endHour: 6 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10) // 02:00 is in 22:00–06:00 range
      expect(result.pointsPrePenalty).toBe(10)
    })

    it('should not match time outside wrap-around range (12:00)', () => {
      const task = createTask({ completedAt: 1700000000000 }) // 2023-11-14 12:00:00 UTC
      const rules: Rule[] = [
        createRule({
          id: 'night-rule',
          mode: 'additive',
          scope: {
            kind: 'time_range',
            value: { startHour: 22, endHour: 6 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(0) // 12:00 is not in 22:00–06:00 range
      expect(result.pointsPrePenalty).toBe(0)
    })

    it('should handle normal time range without wrap-around', () => {
      const task = createTask({ completedAt: 1700000000000 }) // 2023-11-14 12:00:00 UTC
      const rules: Rule[] = [
        createRule({
          id: 'day-rule',
          mode: 'additive',
          scope: {
            kind: 'time_range',
            value: { startHour: 9, endHour: 17 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10) // 12:00 is in 09:00–17:00 range
      expect(result.pointsPrePenalty).toBe(10)
    })
  })

  describe('deadline withinHours matching', () => {
    it('should match task completed within deadline window', () => {
      const dueAt = 1700000000000 // 2023-11-14 12:00:00 UTC
      const completedAt = dueAt + 2 * 60 * 60 * 1000 // 2 hours after due date
      const task = createTask({ dueAt, completedAt })
      const rules: Rule[] = [
        createRule({
          id: 'deadline-rule',
          mode: 'additive',
          scope: {
            kind: 'deadline',
            value: { withinHours: 3 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10) // completed within 3 hours
      expect(result.pointsPrePenalty).toBe(10)
    })

    it('should not match task completed outside deadline window', () => {
      const dueAt = 1700000000000 // 2023-11-14 12:00:00 UTC
      const completedAt = dueAt + 5 * 60 * 60 * 1000 // 5 hours after due date
      const task = createTask({ dueAt, completedAt })
      const rules: Rule[] = [
        createRule({
          id: 'deadline-rule',
          mode: 'additive',
          scope: {
            kind: 'deadline',
            value: { withinHours: 3 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(0) // completed outside 3 hours
      expect(result.pointsPrePenalty).toBe(0)
    })

    it('should match task completed before deadline within window', () => {
      const dueAt = 1700000000000 // 2023-11-14 12:00:00 UTC
      const completedAt = dueAt - 2 * 60 * 60 * 1000 // 2 hours before due date
      const task = createTask({ dueAt, completedAt })
      const rules: Rule[] = [
        createRule({
          id: 'deadline-rule',
          mode: 'additive',
          scope: {
            kind: 'deadline',
            value: { withinHours: 3 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10) // completed within 3 hours (before)
      expect(result.pointsPrePenalty).toBe(10)
    })

    it('should handle task with no deadline', () => {
      const task = createTask({ dueAt: null })
      const rules: Rule[] = [
        createRule({
          id: 'deadline-rule',
          mode: 'additive',
          scope: {
            kind: 'deadline',
            value: { withinHours: 3 },
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(0) // no deadline
      expect(result.pointsPrePenalty).toBe(0)
    })

    it('should handle has_deadline scope', () => {
      const task = createTask({ dueAt: 1700000000000 })
      const rules: Rule[] = [
        createRule({
          id: 'has-deadline-rule',
          mode: 'additive',
          scope: {
            kind: 'deadline',
            value: 'has_deadline',
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10) // has deadline
      expect(result.pointsPrePenalty).toBe(10)
    })

    it('should handle overdue scope', () => {
      const dueAt = 1700000000000 // 2023-11-14 12:00:00 UTC
      const completedAt = dueAt + 2 * 60 * 60 * 1000 // 2 hours after due date
      const task = createTask({ dueAt, completedAt })
      const rules: Rule[] = [
        createRule({
          id: 'overdue-rule',
          mode: 'additive',
          scope: {
            kind: 'deadline',
            value: 'overdue',
          },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10) // is overdue
      expect(result.pointsPrePenalty).toBe(10)
    })
  })

  describe('edge cases', () => {
    it('should handle disabled rules', () => {
      const task = createTask({ tags: ['test'] })
      const rules: Rule[] = [
        createRule({
          id: 'disabled-rule',
          enabled: false,
          mode: 'additive',
          scope: { kind: 'tag', value: 'test' },
          amount: 10,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(0) // disabled rule not applied
      expect(result.pointsPrePenalty).toBe(0)
    })

    it('should handle empty rules array', () => {
      const task = createTask({ tags: ['test'] })
      const rules: Rule[] = []

      const result = evaluateTask(task, rules, [])

      expect(result.baseSource).toBe('none')
      expect(result.exclusiveRuleId).toBeUndefined()
      expect(result.additiveSum).toBe(0)
      expect(result.multiplierProduct).toBe(1)
      expect(result.pointsPrePenalty).toBe(0)
    })

    it('should handle zero multipliers', () => {
      const task = createTask({ tags: ['test'] })
      const rules: Rule[] = [
        createRule({
          id: 'additive-1',
          mode: 'additive',
          scope: { kind: 'tag', value: 'test' },
          amount: 10,
        }),
        createRule({
          id: 'multiplier-zero',
          mode: 'multiplier',
          scope: { kind: 'tag', value: 'test' },
          amount: 0,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(10)
      expect(result.multiplierProduct).toBe(0)
      expect(result.pointsPrePenalty).toBe(0) // (0 + 10) × 0 = 0
    })

    it('should handle fractional results that round to zero', () => {
      const task = createTask({ tags: ['test'] })
      const rules: Rule[] = [
        createRule({
          id: 'additive-small',
          mode: 'additive',
          scope: { kind: 'tag', value: 'test' },
          amount: 0.1,
        }),
        createRule({
          id: 'multiplier-small',
          mode: 'multiplier',
          scope: { kind: 'tag', value: 'test' },
          amount: 0.1,
        }),
      ]

      const result = evaluateTask(task, rules, [])

      expect(result.additiveSum).toBe(0.1)
      expect(result.multiplierProduct).toBe(0.1)
      expect(result.pointsPrePenalty).toBe(0) // Math.round((0 + 0.1) × 0.1) = Math.round(0.01) = 0
    })
  })
})
