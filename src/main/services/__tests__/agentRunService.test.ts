// 契约测试：计划视图映射（给界面看的形状，不含内部结构）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toPlanView } from '../agentRunService.ts'
import { createPlan, markStep, type PlanDraft } from '../../ai/agent/plan.ts'

const NOW = '2026-01-01T00:00:00.000Z'

function planOf(): ReturnType<typeof createPlan> {
  const draft: PlanDraft = {
    goal: '查时间再算个数',
    steps: [
      { action: '取时间', tool: 'now', expect: '拿到 ISO', risk: 'low' },
      { action: '算 1+2', tool: 'calc', expect: '结果 3', risk: 'mid' },
      { action: '写文件', tool: null, expect: '人工确认', risk: 'high' }
    ],
    stopConditions: ['工具连续失败']
  }
  return createPlan(draft, { now: NOW })
}

test('视图带出目标、停止条件与每步状态', () => {
  const view = toPlanView(planOf())

  assert.equal(view.goal, '查时间再算个数')
  assert.equal(view.steps.length, 3)
  assert.deepEqual(view.steps.map((step) => step.status), ['pending', 'pending', 'pending'])
  assert.equal(view.stopConditions.length, 1)
})

test('高风险步骤被标出，界面据此提示需要确认', () => {
  const view = toPlanView(planOf())
  const risky = view.steps.filter((step) => step.requiresConfirmation)
  assert.equal(risky.length, 1)
  assert.equal(risky[0].action, '写文件')
})

test('进度汇总随状态推进变化', () => {
  let plan = planOf()
  plan = markStep(plan, '1', 'success')
  plan = markStep(plan, '2', 'failed')

  const view = toPlanView(plan)
  assert.deepEqual(view.progress, {
    total: 3,
    pending: 1,
    running: 0,
    success: 1,
    failed: 1,
    skipped: 0
  })
})

test('视图只暴露展示所需字段，不含 input 等内部数据', () => {
  const plan = planOf()
  const view = toPlanView(plan)
  assert.equal('input' in view.steps[0], false)
})
