// 契约测试：双轴过滤（Agent ⇄ Project）与驻场状态。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ConversationDto } from '../../../../shared/types/ipc.ts'
import { computeAgentBenchStatus, filterSessionsByAxis } from '../dispatchFilter.ts'

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
  assert.equal(status.activeCount, 2)
  assert.equal(status.lastTitle, '登录文案')
})

test('驻场状态：没有该 Agent 的流式会话时为 idle', () => {
  const status = computeAgentBenchStatus('a1', sessions, 's3')
  assert.equal(status.state, 'idle')
  assert.equal(status.activeCount, 2)
})
