// 契约测试：Plan 协议（校验、构造、状态推进、进度汇总）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createPlan,
  markStep,
  needsConfirmation,
  summarizeProgress,
  validatePlanDraft,
  type PlanDraft
} from '../plan.ts'

const NOW = '2026-01-01T00:00:00.000Z'

function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    goal: '把设计文档拆成可执行步骤',
    steps: [
      { action: '读取文档', expect: '拿到全文且非空', risk: 'low' },
      { action: '拆成步骤', expect: '每步都有验收方式', risk: 'mid' }
    ],
    stopConditions: ['文档不存在时停止并询问'],
    ...overrides
  }
}

test('合法草稿生成计划：步骤状态为 pending，id 自动补全', () => {
  const plan = createPlan(draft(), { now: NOW })

  assert.equal(plan.goal, '把设计文档拆成可执行步骤')
  assert.equal(plan.steps.length, 2)
  assert.deepEqual(
    plan.steps.map((step) => step.id),
    ['1', '2']
  )
  assert.ok(plan.steps.every((step) => step.status === 'pending'))
  assert.equal(plan.createdAt, NOW)
})

test('目标为空被拒绝', () => {
  const result = validatePlanDraft(draft({ goal: '   ' }))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_GOAL_REQUIRED'))
  }
})

test('没有步骤的计划不算计划', () => {
  const result = validatePlanDraft(draft({ steps: [] }))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_STEPS_REQUIRED'))
  }
})

test('步骤缺少验收方式必须被拒绝（没有 expect 就无法判断对错）', () => {
  const result = validatePlanDraft(
    draft({ steps: [{ action: '做点什么', expect: '  ', risk: 'low' }] })
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_STEP_EXPECT_REQUIRED'))
  }
})

test('步骤 id 重复或非法被拒绝', () => {
  const duplicated = validatePlanDraft(
    draft({
      steps: [
        { id: 'a', action: '一', expect: 'x', risk: 'low' },
        { id: 'a', action: '二', expect: 'y', risk: 'low' }
      ]
    })
  )
  assert.equal(duplicated.ok, false)
  if (!duplicated.ok) {
    assert.ok(duplicated.errors.includes('E_STEP_ID_DUPLICATE'))
  }
})

test('风险等级只能是 low / mid / high', () => {
  const result = validatePlanDraft(
    draft({ steps: [{ action: '一', expect: 'x', risk: 'extreme' as never }] })
  )
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_STEP_BAD_RISK'))
  }
})

test('没有停止条件的计划被拒绝（无法叫停的计划不能执行）', () => {
  const result = validatePlanDraft(draft({ stopConditions: [] }))
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_STOP_REQUIRED'))
  }
})

test('推进步骤状态返回新对象，不修改原计划', () => {
  const plan = createPlan(draft(), { now: NOW })
  const next = markStep(plan, '1', 'success')

  assert.equal(plan.steps[0].status, 'pending', '原计划不能被动过')
  assert.equal(next.steps[0].status, 'success')
  assert.notEqual(next, plan)
})

test('推进不存在的步骤会抛错，避免静默写坏状态', () => {
  const plan = createPlan(draft(), { now: NOW })
  assert.throws(() => markStep(plan, 'missing', 'success'), /E_STEP_NOT_FOUND/)
})

test('进度汇总与高风险步骤识别', () => {
  let plan = createPlan(
    draft({
      steps: [
        { action: '读', expect: 'x', risk: 'low' },
        { action: '写文件', expect: 'y', risk: 'high' },
        { action: '发请求', expect: 'z', risk: 'mid' }
      ]
    }),
    { now: NOW }
  )
  plan = markStep(plan, '1', 'success')
  plan = markStep(plan, '2', 'failed')

  assert.deepEqual(summarizeProgress(plan), {
    total: 3,
    pending: 1,
    running: 0,
    success: 1,
    failed: 1,
    skipped: 0
  })
  assert.deepEqual(
    needsConfirmation(plan).map((step) => step.id),
    ['2'],
    '高风险步骤要先问人'
  )
})

test('权限模式决定确认门：五档各自不同', () => {
  const p = createPlan(
    {
      goal: '五档确认门',
      steps: [
        { action: '读', expect: 'ok', risk: 'low' },
        { action: '读文件', tool: 'read_text_file', input: null, expect: 'ok', risk: 'low' },
        { action: '中风险', expect: 'ok', risk: 'mid' },
        { action: '高风险', tool: 'run', input: null, expect: 'ok', risk: 'high' }
      ],
      stopConditions: ['出错即停']
    },
    { now: NOW }
  )
  assert.deepEqual(needsConfirmation(p, 'smart').map((s) => s.id), ['4'])
  assert.deepEqual(needsConfirmation(p, 'auto-edit').map((s) => s.id), ['4'])
  assert.deepEqual(needsConfirmation(p, 'ask').map((s) => s.id), ['2', '3', '4'])
  assert.deepEqual(needsConfirmation(p, 'plan-only').map((s) => s.id), ['2', '3', '4'])
  assert.deepEqual(needsConfirmation(p, 'full-access').map((s) => s.id), [])
  // 缺省仍是 smart，保持旧行为
  assert.deepEqual(needsConfirmation(p).map((s) => s.id), ['4'])
})
