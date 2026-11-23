// 契约测试：多模型对比（并行、单点失败隔离、顺序稳定）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { compareAcross, type ComparisonTarget } from '../comparisonService.ts'
import type { ChatProvider, ChatStreamRequest } from '../../ai/providers/types.ts'

function providerOf(
  chunks: string[],
  seen?: ChatStreamRequest[],
  fail = false
): ChatProvider {
  return {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      if (seen) {
        seen.push(request)
      }
      if (fail) {
        throw new Error('boom')
      }
      for (const chunk of chunks) {
        yield chunk
      }
    }
  }
}

function target(overrides: Partial<ComparisonTarget> & { id: string }): ComparisonTarget {
  return {
    label: overrides.id,
    provider: providerOf(['答']),
    model: 'm',
    baseUrl: 'https://example.invalid',
    apiKey: 'k',
    ...overrides
  }
}

test('两个平台都成功时各自返回文本，顺序与入参一致', async () => {
  const results = await compareAcross('问题', [
    target({ id: 'a', label: 'DeepSeek', provider: providerOf(['甲']) }),
    target({ id: 'b', label: 'Ollama', provider: providerOf(['乙']) })
  ])

  assert.equal(results.length, 2)
  assert.deepEqual(
    results.map((item) => `${item.targetId}:${item.status}:${item.text}`),
    ['a:success:甲', 'b:success:乙']
  )
  assert.equal(results[0].label, 'DeepSeek')
})

test('单点失败被隔离，其他平台不受影响', async () => {
  const results = await compareAcross('问题', [
    target({ id: 'ok', provider: providerOf(['甲']) }),
    target({ id: 'bad', provider: providerOf([], undefined, true) })
  ])

  const ok = results.find((item) => item.targetId === 'ok')
  const bad = results.find((item) => item.targetId === 'bad')

  assert.equal(ok?.status, 'success')
  assert.equal(ok?.text, '甲')
  assert.equal(bad?.status, 'error')
  assert.ok(bad?.error && bad.error.length > 0)
  assert.equal(bad?.text, '', '失败时不该残留半截文本')
})

test('每个目标用自己的模型与凭据，互不串台', async () => {
  const seenA: ChatStreamRequest[] = []
  const seenB: ChatStreamRequest[] = []

  await compareAcross('问题', [
    target({ id: 'a', model: 'model-a', apiKey: 'key-a', provider: providerOf(['x'], seenA) }),
    target({ id: 'b', model: 'model-b', apiKey: 'key-b', provider: providerOf(['y'], seenB) })
  ])

  assert.equal(seenA[0].model, 'model-a')
  assert.equal(seenA[0].apiKey, 'key-a')
  assert.equal(seenB[0].model, 'model-b')
  assert.equal(seenB[0].apiKey, 'key-b')
})

test('目标是并行执行的（慢的不拖累快的）', async () => {
  const delays: number[] = []
  const slow: ChatProvider = {
    id: 'slow',
    async *streamChat(): AsyncGenerator<string> {
      await new Promise((resolve) => setTimeout(resolve, 60))
      delays.push(Date.now())
      yield '慢'
    }
  }
  const fast: ChatProvider = {
    id: 'fast',
    async *streamChat(): AsyncGenerator<string> {
      delays.push(Date.now())
      yield '快'
    }
  }

  const started = Date.now()
  await compareAcross('问题', [
    target({ id: 'slow', provider: slow }),
    target({ id: 'fast', provider: fast })
  ])

  assert.equal(delays.length, 2)
  assert.ok(delays[0] < delays[1], '快的应先完成')
  assert.ok(Date.now() - started < 500, '不该串行等待')
})

test('空目标列表返回空结果，不发起任何请求', async () => {
  const seen: ChatStreamRequest[] = []
  const results = await compareAcross('问题', [])
  assert.deepEqual(results, [])
  assert.equal(seen.length, 0)
})

test('结果里带耗时，便于界面上比较', async () => {
  const results = await compareAcross('问题', [target({ id: 'a' })])
  assert.ok(results[0].durationMs >= 0)
})
