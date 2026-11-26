// 契约测试：聊天界面的状态转换（纯函数，不依赖 DOM）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  appendChunk,
  markStatus,
  removeMessage,
  startTurn,
  type UiMessage
} from '../chatState.ts'

const ROUTE = {
  traceId: 't-1',
  chosenModel: 'deepseek-chat',
  decidedBy: 'heuristic:local',
  confidence: 0.6,
  difficulty: { level: 1, category: 'chat' },
  attempt: 0,
  escalationLadder: [{ model: 'deepseek-chat', pSuccess: 0.6 }]
}

function messages(): UiMessage[] {
  return [
    { id: 'u1', role: 'user', content: '你好', status: 'complete' },
    { id: 'a1', role: 'assistant', content: '', status: 'streaming' }
  ]
}

test('startTurn 生成用户消息与空气泡两条', () => {
  const next = startTurn([], { requestId: 'r1', text: '你好' })

  assert.equal(next.length, 2)
  assert.equal(next[0].role, 'user')
  assert.equal(next[0].content, '你好')
  assert.equal(next[1].id, 'r1', '助手气泡用请求 id，chunk 才能归并')
  assert.equal(next[1].status, 'streaming')
})

test('chunk 追加到对应消息，且不修改原数组', () => {
  const original = messages()
  const next = appendChunk(original, 'a1', '你')

  assert.equal(next[1].content, '你')
  assert.equal(original[1].content, '', '原数组不能被就地改写')
  assert.notEqual(next, original)
})

test('未知 id 的 chunk 被忽略，不会凭空造消息', () => {
  const original = messages()
  const next = appendChunk(original, 'nope', 'x')
  assert.deepEqual(next, original)
})

test('markStatus 只改目标消息的状态', () => {
  const next = markStatus(messages(), 'a1', 'complete')
  assert.equal(next[1].status, 'complete')
  assert.equal(next[0].status, 'complete', '其他消息不受影响')
})

test('错误且无内容时给出占位文案，避免空白气泡', () => {
  const next = markStatus(messages(), 'a1', 'error')
  assert.equal(next[1].status, 'error')
  assert.ok(next[1].content.length > 0, '空内容 + error 必须有占位')
})

test('错误但有内容时保留已产出的部分', () => {
  let next = appendChunk(messages(), 'a1', '半句')
  next = markStatus(next, 'a1', 'error')
  assert.equal(next[1].content, '半句')
})

test('startTurn 可以带上这一轮的路由决策，只挂在助手气泡上', () => {
  const next = startTurn([], { requestId: 'r1', text: '你好', route: ROUTE })
  assert.equal(next[0].route, undefined)
  assert.equal(next[1].route?.chosenModel, 'deepseek-chat')
})

test('没给决策时气泡上留 null，界面不显示徽章', () => {
  const next = startTurn([], { requestId: 'r2', text: '你好' })
  assert.equal(next[1].route, null)
})

test('removeMessage 按 id 移除，重复调用幂等', () => {
  const once = removeMessage(messages(), 'u1')
  assert.deepEqual(once.map((item) => item.id), ['a1'])
  assert.deepEqual(removeMessage(once, 'u1').map((item) => item.id), ['a1'])
})
