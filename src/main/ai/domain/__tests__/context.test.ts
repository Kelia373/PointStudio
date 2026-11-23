// 契约测试：上下文裁剪（把多轮历史塞进有限的窗口里）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { estimateTokens, trimHistory, type ContextMessage } from '../context.ts'

function message(role: ContextMessage['role'], content: string): ContextMessage {
  return { role, content }
}

test('按条数裁剪：保留最近的，并报告丢了几条', () => {
  const history = [
    message('user', '一'),
    message('assistant', '二'),
    message('user', '三'),
    message('assistant', '四')
  ]
  const result = trimHistory(history, { maxMessages: 2 })

  assert.deepEqual(result.messages.map((m) => m.content), ['三', '四'])
  assert.equal(result.droppedCount, 2)
})

test('未超上限时原样返回，不丢任何一条', () => {
  const history = [message('user', '一'), message('assistant', '二')]
  const result = trimHistory(history, { maxMessages: 10, maxTokens: 1000 })

  assert.equal(result.messages.length, 2)
  assert.equal(result.droppedCount, 0)
})

test('按 token 预算裁剪：从头丢，保证最后一条一定留', () => {
  const history = [
    message('user', '很长的开场白'.repeat(20)),
    message('assistant', '回复'.repeat(20)),
    message('user', '短')
  ]
  const result = trimHistory(history, { maxTokens: 20 })

  assert.ok(result.messages.length >= 1)
  assert.equal(result.messages[result.messages.length - 1].content, '短')
  assert.ok(result.droppedCount > 0)
})

test('单条就超预算时也保留它，不切碎消息', () => {
  const huge = '巨'.repeat(1000)
  const result = trimHistory([message('user', huge)], { maxTokens: 10 })

  assert.equal(result.messages.length, 1, '最后一条必须保留，哪怕它本身超预算')
  assert.equal(result.messages[0].content, huge, '消息不能被截断')
  assert.equal(result.droppedCount, 0)
})

test('空历史返回空结果', () => {
  const result = trimHistory([], { maxMessages: 5 })
  assert.deepEqual(result.messages, [])
  assert.equal(result.droppedCount, 0)
})

test('token 估算：中文按字、英文按 4 字符 1 token，且为 0 时返回 0', () => {
  assert.equal(estimateTokens(''), 0)
  assert.ok(estimateTokens('你好世界') >= 4, '中文不能按 4 字符 1 token 算')
  assert.equal(estimateTokens('abcd'), 1)
  assert.ok(estimateTokens('中文 mixed content') > 4)
})
