// 契约测试：动静切片的关键承诺——流式吐字时历史数组引用必须不变。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { UiMessage } from '../../lib/chatState.ts'
import { createStudioStore, splitMessages } from '../studioStore.ts'

function message(id: string, content: string, status: UiMessage['status'] = 'complete'): UiMessage {
  return { id, role: 'assistant', content, status } as UiMessage
}

test('只有 inflight 内容变化时，historyMessages 引用保持不变', () => {
  const store = createStudioStore()
  const history = [message('m1', '一'), message('m2', '二')]

  store.replaceMessages([...history, message('m3', '流', 'streaming')], 'm3')
  const firstHistory = store.getState().historyMessages

  store.replaceMessages([...history, message('m3', '流式', 'streaming')], 'm3')
  const secondHistory = store.getState().historyMessages

  assert.equal(store.getState().inflightMessage?.content, '流式')
  assert.equal(secondHistory, firstHistory, '历史切片必须复用同一引用，否则长列表全量重绘')
})

test('inflight 结束后并入历史，历史数组随之更新', () => {
  const store = createStudioStore()
  store.replaceMessages([message('m1', '一'), message('m2', '二', 'streaming')], 'm2')

  const before = store.getState().historyMessages
  store.replaceMessages([message('m1', '一'), message('m2', '二')], null)
  const after = store.getState().historyMessages

  assert.notEqual(after, before)
  assert.equal(after.length, 2)
  assert.equal(store.getState().inflightMessage, null)
})

test('没有 inflightId 时全部算历史', () => {
  const split = splitMessages([message('a', 'x'), message('b', 'y')], null)
  assert.equal(split.history.length, 2)
  assert.equal(split.inflight, null)
})
