// 契约测试：目标自动循环（生成 → 执行 → 失败 → 重规划 → 再执行）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { runGoal } from '../agentLoop.ts'
import { createPlan, type Plan, type PlanDraft } from '../../ai/agent/plan.ts'
import type { ExecuteResult } from '../../ai/agent/executor.ts'
import type { GeneratePlanResult } from '../planService.ts'

const NOW = '2026-01-01T00:00:00.000Z'

function draft(action: string): PlanDraft {
  return {
    goal: '做一件事',
    steps: [{ action, tool: 'now', expect: '拿到结果', risk: 'low' }],
    stopConditions: ['连续失败就停']
  }
}

function planOf(action: string): Plan {
  return createPlan(draft(action), { now: NOW })
}

const okPlan = (action: string): GeneratePlanResult => ({ ok: true, value: planOf(action) })

function execResult(
  plan: Plan,
  status: ExecuteResult['status'],
  failedStepId = plan.steps[0]?.id ?? '1',
  reason = 'E_TOOL_FAILED'
): ExecuteResult {
  return {
    plan,
    status,
    reason: status === 'completed' ? undefined : reason,
    stepResults: plan.steps.map((step) => ({
      id: step.id,
      status: status === 'failed' && step.id === failedStepId ? 'failed' : 'success'
    }))
  }
}

test('一次生成就成功：状态 completed，只执行一次', async () => {
  const executed: string[] = []
  const result = await runGoal('做一件事', {
    generate: async () => okPlan('第一步'),
    execute: async (plan) => {
      executed.push(plan.steps[0].action)
      return execResult(plan, 'completed')
    },
    replan: async () => {
      throw new Error('不该重规划')
    }
  })

  assert.equal(result.status, 'completed')
  assert.deepEqual(executed, ['第一步'])
  assert.equal(result.history.length, 1)
})

test('执行失败后重规划并再次执行，最终成功', async () => {
  const replanCalls: Array<{ failedStepId: string; errorCode: string }> = []
  let round = 0

  const result = await runGoal('做一件事', {
    generate: async () => okPlan('第一版'),
    execute: async (plan) => {
      round += 1
      return round === 1 ? execResult(plan, 'failed') : execResult(plan, 'completed')
    },
    replan: async (input) => {
      replanCalls.push({ failedStepId: input.failedStepId, errorCode: input.errorCode })
      return okPlan('第二版')
    }
  })

  assert.equal(result.status, 'completed')
  assert.equal(result.history.length, 2)
  assert.deepEqual(replanCalls, [{ failedStepId: '1', errorCode: 'E_TOOL_FAILED' }])
  assert.equal(result.plan.steps[0].action, '第二版')
})

test('重规划次数用尽仍失败：返回 failed 并保留最后一版计划', async () => {
  let replans = 0
  const result = await runGoal('做一件事', {
    maxReplans: 2,
    generate: async () => okPlan('一直失败'),
    execute: async (plan) => execResult(plan, 'failed'),
    replan: async () => {
      replans += 1
      return okPlan(`修订 ${replans}`)
    }
  })

  assert.equal(result.status, 'failed')
  assert.equal(replans, 2, '重规划次数应受上限约束')
  assert.equal(result.plan.steps[0].action, '修订 2')
  assert.equal(result.reason, 'E_TOOL_FAILED')
})

test('生成阶段失败时不执行任何步骤', async () => {
  let executed = false
  const result = await runGoal('做一件事', {
    generate: async () => ({ ok: false, errors: ['E_PLAN_JSON_INVALID'] }),
    execute: async (plan) => {
      executed = true
      return execResult(plan, 'completed')
    },
    replan: async () => okPlan('x')
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'E_PLAN_GENERATION_FAILED')
  assert.equal(executed, false)
  assert.deepEqual(result.errors, ['E_PLAN_JSON_INVALID'])
})

test('执行被确认门拦下时直接停止，不做重规划', async () => {
  let replanned = false
  const result = await runGoal('做一件事', {
    generate: async () => okPlan('需要确认的'),
    execute: async (plan) => execResult(plan, 'stopped', '1', 'E_STEP_NEEDS_CONFIRMATION'),
    replan: async () => {
      replanned = true
      return okPlan('x')
    }
  })

  assert.equal(result.status, 'stopped')
  assert.equal(result.reason, 'E_STEP_NEEDS_CONFIRMATION')
  assert.equal(replanned, false, '待确认不是失败，重规划解决不了它')
})

test('重规划本身失败时返回失败，不再继续执行', async () => {
  let executions = 0
  const result = await runGoal('做一件事', {
    generate: async () => okPlan('会失败'),
    execute: async (plan) => {
      executions += 1
      return execResult(plan, 'failed')
    },
    replan: async () => ({ ok: false, errors: ['E_PLAN_GENERATION_FAILED'] })
  })

  assert.equal(result.status, 'failed')
  assert.equal(executions, 1, '重规划失败后不该再执行')
  assert.equal(result.reason, 'E_REPLAN_FAILED')
})

test('每次计划与步骤变化都会回调，便于界面展示过程', async () => {
  const events: string[] = []
  await runGoal('做一件事', {
    generate: async () => okPlan('第一步'),
    execute: async (plan, options) => {
      options.onStepChange?.(plan)
      return execResult(plan, 'completed')
    },
    replan: async () => okPlan('x'),
    onPlan: () => events.push('plan'),
    onStepChange: () => events.push('step')
  })

  assert.deepEqual(events, ['plan', 'step'])
})
