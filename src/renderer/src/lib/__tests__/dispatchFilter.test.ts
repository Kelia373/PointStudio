// 契约测试：双轴过滤（Agent ⇄ Project）与驻场状态。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { AgentWorkerRunDto, ConversationDto } from '../../../../shared/types/ipc.ts'
import { computeAgentBenchStatus, computeAgentWorkerLanes, filterSessionsByAxis } from '../dispatchFilter.ts'

function session(over: Partial<ConversationDto> & { id: string }): ConversationDto {
  return {
    title: over.id,
    assistantId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over
  } as ConversationDto
}

const sessions: ConversationDto[] = [
  session({ id: 's1', title: '修复登录', assistantId: 'a1', workspaceId: 'w1' }),
  session({ id: 's2', title: '登录文案', assistantId: 'a1', workspaceId: null }),
  session({ id: 's3', title: '重构调度', assistantId: 'a2', workspaceId: 'w1' }),
  session({ id: 's4', title: '随手问一句', assistantId: null })
]

test('不传轴时返回全部会话', () => {
  assert.equal(filterSessionsByAxis(sessions, {}).length, 4)
})

test('按 Agent 过滤：拿到该 Agent 跨项目的全部执行记录', () => {
  const rows = filterSessionsByAxis(sessions, { agentId: 'a1' })
  assert.deepEqual(rows.map((r) => r.id), ['s1', 's2'])
})

test('按 Project 过滤：拿到该项目下不同 Agent 的记录', () => {
  const rows = filterSessionsByAxis(sessions, { workspaceId: 'w1' })
  assert.deepEqual(rows.map((r) => r.id), ['s1', 's3'])
})

test("'unmounted' 只取未挂载项目的随手聊", () => {
  const rows = filterSessionsByAxis(sessions, { workspaceId: 'unmounted' })
  assert.deepEqual(rows.map((r) => r.id), ['s2', 's4'])
})

test('双轴叠加时取交集', () => {
  const rows = filterSessionsByAxis(sessions, { agentId: 'a1', workspaceId: 'w1' })
  assert.deepEqual(rows.map((r) => r.id), ['s1'])
})

test('小组视图：agentIds 取并集，未绑 Agent 的会话被排除', () => {
  assert.deepEqual(
    filterSessionsByAxis(sessions, { agentIds: ['a1', 'a2'] }).map((r) => r.id),
    ['s1', 's2', 's3']
  )
  assert.deepEqual(
    filterSessionsByAxis(sessions, { agentIds: ['a2'], workspaceId: 'w1' }).map((r) => r.id),
    ['s3']
  )
  // 空数组视为不限制
  assert.equal(filterSessionsByAxis(sessions, { agentIds: [] }).length, 4)
})

test('关键词与轴叠加，且忽略大小写与空白', () => {
  assert.deepEqual(
    filterSessionsByAxis(sessions, { keyword: ' 登录 ' }).map((r) => r.id),
    ['s1', 's2']
  )
  assert.deepEqual(
    filterSessionsByAxis(sessions, { agentId: 'a1', keyword: '文案' }).map((r) => r.id),
    ['s2']
  )
})

test('驻场状态：有会话正在流式输出时该 Agent 为 working', () => {
  const status = computeAgentBenchStatus('a1', sessions, 's2')
  assert.equal(status.state, 'working')
  assert.equal(status.sessionCount, 2)
  assert.equal(status.activeRunCount, 1)
  assert.equal(status.activeCount, 2)
  assert.equal(status.lastTitle, '登录文案')
})

test('驻场状态：没有该 Agent 的流式会话时为 idle', () => {
  const status = computeAgentBenchStatus('a1', sessions, 's3')
  assert.equal(status.state, 'idle')
  assert.equal(status.sessionCount, 2)
  assert.equal(status.activeRunCount, 0)
  assert.equal(status.activeCount, 2)
})

test('驻场状态：停用优先于一切瞬时态，且仍保留计数', () => {
  const status = computeAgentBenchStatus('a1', sessions, 's2', { enabled: false })
  assert.equal(status.state, 'disabled')
  assert.equal(status.sessionCount, 2)
  assert.equal(status.activeRunCount, 1)
  assert.equal(status.activeCount, 2)
  assert.equal(status.lastTitle, '登录文案')
})

test('驻场状态：当前会话的计划在跑时该 Agent 为 working', () => {
  const status = computeAgentBenchStatus('a1', sessions, null, {
    planStatus: 'running',
    activeSessionId: 's1'
  })
  assert.equal(status.state, 'working')
  assert.equal(status.lastTitle, '修复登录')
})

test('驻场状态：计划等待人工确认时为 waiting', () => {
  const status = computeAgentBenchStatus('a1', sessions, null, {
    planStatus: 'stopped',
    activeSessionId: 's1'
  })
  assert.equal(status.state, 'waiting')
})

test('驻场状态：计划失败时为 error', () => {
  const status = computeAgentBenchStatus('a1', sessions, null, {
    planStatus: 'failed',
    activeSessionId: 's2'
  })
  assert.equal(status.state, 'error')
})

test('驻场状态：计划不属于该 Agent 的会话时不算数', () => {
  // s3 挂在 a2 上：a1 不该因为别人在跑计划而亮灯
  const status = computeAgentBenchStatus('a1', sessions, null, {
    planStatus: 'running',
    activeSessionId: 's3'
  })
  assert.equal(status.state, 'idle')
})

function run(over: Partial<AgentWorkerRunDto> & { runId: string }): AgentWorkerRunDto {
  return {
    agentId: 'a1',
    subagentRole: null,
    missionId: 'm1',
    dispatchedBy: 'owner',
    taskTitle: '任务',
    sessionId: 's1',
    status: 'working',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

test('并发泳道：只算自己名下的未完成 Run，working 排前面', () => {
  const lanes = computeAgentWorkerLanes('a1', [
    run({ runId: 'r1', status: 'waiting' }),
    run({ runId: 'r2', subagentRole: '素材 Subagent' }),
    run({ runId: 'r3', status: 'completed' }),
    run({ runId: 'r4', agentId: 'a2' })
  ])
  assert.deepEqual(
    lanes.activeRuns.map((item) => item.runId),
    ['r2', 'r1']
  )
  assert.equal(lanes.workingCount, 1)
  assert.equal(lanes.subagentCount, 1)
})

test('多 Run 台账接管后：并发数进 activeRunCount，任一 working 即亮绿灯', () => {
  const runs = [run({ runId: 'r1' }), run({ runId: 'r2', status: 'queued', taskTitle: '排队中' })]
  const status = computeAgentBenchStatus('a1', sessions, null, { workerRuns: runs })
  assert.equal(status.state, 'working')
  assert.equal(status.sessionCount, 2)
  assert.equal(status.activeRunCount, 2)
  assert.equal(status.activeCount, 2)
  assert.equal(status.lastTitle, '任务')
})

test('多 Run 台账：只剩 waiting/error 时分别亮橙与红', () => {
  const waiting = computeAgentBenchStatus('a1', sessions, null, {
    workerRuns: [run({ runId: 'r1', status: 'waiting' })]
  })
  assert.equal(waiting.state, 'waiting')
  const error = computeAgentBenchStatus('a1', sessions, null, {
    workerRuns: [run({ runId: 'r1', status: 'error' })]
  })
  assert.equal(error.state, 'error')
})
