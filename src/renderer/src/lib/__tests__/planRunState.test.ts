// 契约测试：Agent 事件 → 计划面板状态的归约。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { reduceAgentEvent, type PlanRunState } from '../planRunState.ts'
import type { AgentEventDto, PlanViewDto } from '../../../../shared/types/ipc.ts'

function plan(goal: string): PlanViewDto {
  return {
    goal,
    assumptions: [],
    stopConditions: [],
    steps: [],
    progress: { total: 0, pending: 0, running: 0, success: 0, failed: 0, skipped: 0 }
  }
}

const idle: PlanRunState = { id: 'r1', plan: null, status: 'running' }

test('plan 事件：填充计划并进入运行中', () => {
  const next = reduceAgentEvent(idle, { type: 'plan', plan: plan('目标') })
  assert.equal(next?.status, 'running')
  assert.equal(next?.plan?.goal, '目标')
})

test('done 事件：带上最终状态与步骤详情', () => {
  const event: AgentEventDto = {
    type: 'done',
    status: 'completed',
    plan: plan('完成的目标'),
    details: [{ id: '1', status: 'success', tool: 'now', durationMs: 12 }]
  }
  const next = reduceAgentEvent(idle, event)

  assert.equal(next?.status, 'completed')
  assert.equal(next?.plan?.goal, '完成的目标')
  assert.equal(next?.details?.[0].tool, 'now')
})

test('error 事件：标记失败但保留已有计划', () => {
  const withPlan = reduceAgentEvent(idle, { type: 'plan', plan: plan('中途失败') })
  const next = reduceAgentEvent(withPlan, { type: 'error', code: 'E_INTERNAL' })

  assert.equal(next?.status, 'failed')
  assert.equal(next?.plan?.goal, '中途失败', '已经显示的计划不该被清空')
})

test('replan 事件不改变面板状态（仍在跑）', () => {
  const withPlan = reduceAgentEvent(idle, { type: 'plan', plan: plan('重规划中') })
  const next = reduceAgentEvent(withPlan, {
    type: 'replan',
    failedStepId: '1',
    errorCode: 'E_TOOL_FAILED'
  })

  assert.equal(next?.status, 'running')
  assert.equal(next?.plan?.goal, '重规划中')
})

test('没有在跑的任务时，事件被忽略（返回原值）', () => {
  const next = reduceAgentEvent(null, { type: 'plan', plan: plan('不该出现') })
  assert.equal(next, null)
})

test('不修改入参（React 依赖引用变化）', () => {
  const original: PlanRunState = { ...idle }
  const next = reduceAgentEvent(original, { type: 'plan', plan: plan('新的') })

  assert.equal(original.plan, null)
  assert.notEqual(next, original)
})

test('sessionId 跟着计划走：归约任何事件都不丢发起会话', () => {
  const withSession: PlanRunState = { ...idle, sessionId: 'session-a' }
  const next = reduceAgentEvent(withSession, { type: 'plan', plan: plan('目标') })
  assert.equal(next?.sessionId, 'session-a')
  const done = reduceAgentEvent(next, {
    type: 'done',
    status: 'completed',
    plan: plan('目标'),
    details: []
  })
  assert.equal(done?.sessionId, 'session-a')
})
