// 契约测试：从真实运行态派生并发泳道。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ConversationDto, PlanViewDto } from '../../../../shared/types/ipc.ts'
import type { PlanRunState } from '../planRunState.ts'
import { deriveActiveWorkerRuns } from '../workerRuns.ts'

function conversation(id: string, assistantId: string | null, title = id): ConversationDto {
  return {
    id,
    title,
    assistantId,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

function plan(total: number, success: number, stepAction = '改 Sidebar'): PlanViewDto {
  return {
    goal: '四项 UI',
    assumptions: [],
    stopConditions: [],
    steps: [
      {
        id: '1',
        action: stepAction,
        tool: null,
        expect: '',
        risk: 'low',
        status: 'running',
        requiresConfirmation: false
      }
    ],
    progress: { total, pending: 0, running: 1, success, failed: 0, skipped: 0 }
  }
}

function planRun(over: Partial<PlanRunState> = {}): PlanRunState {
  return { id: 'p1', plan: plan(4, 2), status: 'running', sessionId: 's1', ...over }
}

test('流式中的会话派生一条 working 主身 Run', () => {
  const runs = deriveActiveWorkerRuns({
    conversations: [conversation('s1', 'a1', '修复登录')],
    inflightConversationId: 's1',
    planRun: null
  })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'working')
  assert.equal(runs[0].agentId, 'a1')
  assert.equal(runs[0].taskTitle, '修复登录')
  assert.equal(runs[0].missionId, 's1')
  assert.equal(runs[0].subagentRole, null)
})

test('没绑 Agent 的会话不产 Run（不画空壳）', () => {
  const runs = deriveActiveWorkerRuns({
    conversations: [conversation('s1', null)],
    inflightConversationId: 's1',
    planRun: null
  })
  assert.deepEqual(runs, [])
})

test('计划在跑：带真实进度与当前步骤', () => {
  const runs = deriveActiveWorkerRuns({
    conversations: [conversation('s1', 'a1')],
    inflightConversationId: null,
    planRun: planRun()
  })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'working')
  assert.deepEqual(runs[0].progress, { current: 2, total: 4, stepLabel: '改 Sidebar' })
})

test('计划暂停 / 失败分别映射成 waiting / error', () => {
  const base = {
    conversations: [conversation('s1', 'a1')],
    inflightConversationId: null
  }
  assert.equal(
    deriveActiveWorkerRuns({ ...base, planRun: planRun({ status: 'stopped' }) })[0].status,
    'waiting'
  )
  assert.equal(
    deriveActiveWorkerRuns({ ...base, planRun: planRun({ status: 'failed' }) })[0].status,
    'error'
  )
  // 已完成不再占泳道
  assert.deepEqual(
    deriveActiveWorkerRuns({ ...base, planRun: planRun({ status: 'completed' }) }),
    []
  )
})

test('同会话流式 + 计划：合并成一条，状态取流式，进度保留', () => {
  const runs = deriveActiveWorkerRuns({
    conversations: [conversation('s1', 'a1')],
    inflightConversationId: 's1',
    planRun: planRun({ status: 'stopped' })
  })
  assert.equal(runs.length, 1)
  assert.equal(runs[0].status, 'working')
  assert.deepEqual(runs[0].progress, { current: 2, total: 4, stepLabel: '改 Sidebar' })
})

test('流式会话与计划会话不同时，自然形成两条并发泳道', () => {
  const runs = deriveActiveWorkerRuns({
    conversations: [conversation('s1', 'a1'), conversation('s2', 'a2')],
    inflightConversationId: 's1',
    planRun: planRun({ sessionId: 's2' })
  })
  assert.equal(runs.length, 2)
  assert.deepEqual(
    runs.map((run) => run.sessionId).sort(),
    ['s1', 's2']
  )
})
