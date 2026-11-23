// 契约测试：从计划视图里取出需要确认的步骤（供界面「确认并继续」）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { highRiskStepIds, pendingHighRiskStepIds } from '../planConfirm.ts'
import type { PlanViewDto } from '../../../../shared/types/ipc.ts'

function plan(steps: PlanViewDto['steps']): PlanViewDto {
  return {
    goal: '目标',
    assumptions: [],
    stopConditions: [],
    steps,
    progress: { total: steps.length, pending: 0, running: 0, success: 0, failed: 0, skipped: 0 }
  }
}

function step(
  id: string,
  risk: 'low' | 'mid' | 'high',
  status: PlanViewDto['steps'][number]['status'] = 'pending'
): PlanViewDto['steps'][number] {
  return { id, action: `步骤${id}`, tool: null, expect: 'ok', risk, status, requiresConfirmation: risk === 'high' }
}

test('取出所有高风险步骤的 id', () => {
  const ids = highRiskStepIds(
    plan([step('1', 'low'), step('2', 'high'), step('3', 'mid'), step('4', 'high')])
  )
  assert.deepEqual(ids, ['2', '4'])
})

test('没有高风险步骤时返回空数组', () => {
  assert.deepEqual(highRiskStepIds(plan([step('1', 'low')])), [])
})

test('「待确认」只算还没执行的：已完成的高风险步骤不再要求确认', () => {
  const ids = pendingHighRiskStepIds(
    plan([step('1', 'high', 'success'), step('2', 'high', 'pending'), step('3', 'high', 'skipped')])
  )
  assert.deepEqual(ids, ['2'], '成功或跳过的步骤不该再拦住计划')
})

test('全部高风险步骤都已执行时返回空数组', () => {
  const ids = pendingHighRiskStepIds(plan([step('1', 'high', 'success')]))
  assert.deepEqual(ids, [])
})
