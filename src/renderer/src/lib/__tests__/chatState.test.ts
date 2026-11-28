// 契约测试：聊天界面的状态转换（纯函数，不依赖 DOM）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  appendChunk,
  markStatus,
  removeMessage,
  startTurn,
  storedToUiMessages,
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

test('storedToUiMessages：落库消息的 images 与归因三字段都必须带回界面', () => {
  const images = [
    { id: '11111111-1111-4111-8111-111111111111', mimeType: 'image/png' as const, name: 'a.png', sizeBytes: 12 }
  ]
  const mapped = storedToUiMessages([
    {
      id: 'm1',
      role: 'user',
      content: '[Image #1] 看图',
      status: 'complete',
      images
    },
    {
      id: 'm2',
      role: 'assistant',
      content: '好',
      status: 'complete',
      assistantId: 'a1',
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    }
  ])
  assert.deepEqual(mapped[0].images, images)
  assert.equal(mapped[1].images, undefined, '无图消息不带字段')
  assert.equal(mapped[1].assistantId, 'a1', '历史归因不能被映射抹掉')
  assert.equal(mapped[1].providerId, 'deepseek')
  assert.equal(mapped[1].modelId, 'deepseek-chat')
})

test('startTurn：乐观渲染的占位回复带归因，流式期间不退回品牌标', () => {
  const next = startTurn([], {
    requestId: 'req-1',
    text: '你好',
    attribution: { assistantId: 'a1', providerId: 'deepseek', modelId: 'deepseek-chat' }
  })
  const placeholder = next.find((message) => message.id === 'req-1')
  assert.equal(placeholder?.assistantId, 'a1')
  assert.equal(placeholder?.providerId, 'deepseek')
  assert.equal(placeholder?.modelId, 'deepseek-chat')

  const plain = startTurn([], { requestId: 'req-2', text: 'hi' })
  assert.equal(plain[1].assistantId, undefined, '不传归因就不带字段')
})
