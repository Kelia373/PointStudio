// 契约测试：流式请求的取消登记（按 id 取消 / 未知 id 无副作用 / 收尾清理）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { StreamRegistry } from '../streamRegistry.ts'

test('按 id 取消会触发对应的 AbortSignal', () => {
  const registry = new StreamRegistry()
  const { id, signal } = registry.create()

  assert.equal(signal.aborted, false)
  assert.equal(registry.cancel(id), true)
  assert.equal(signal.aborted, true)
})

test('取消不存在的 id 返回 false，不抛异常', () => {
  const registry = new StreamRegistry()
  assert.equal(registry.cancel('missing'), false)
})

test('收尾后不能再次取消（避免误伤后续同 id 请求）', () => {
  const registry = new StreamRegistry()
  const { id, signal } = registry.create()

  registry.dispose(id)
  assert.equal(registry.cancel(id), false)
  assert.equal(signal.aborted, false, '正常收尾不该把信号置为已中断')
})

test('多个流互不影响', () => {
  const registry = new StreamRegistry()
  const first = registry.create()
  const second = registry.create()

  registry.cancel(first.id)
  assert.equal(first.signal.aborted, true)
  assert.equal(second.signal.aborted, false)
})

test('收尾全部后登记表为空（防止长跑应用里泄漏）', () => {
  const registry = new StreamRegistry()
  const first = registry.create()
  const second = registry.create()
  registry.dispose(first.id)
  registry.dispose(second.id)

  assert.equal(registry.size(), 0)
})

test('重复 dispose 是幂等的', () => {
  const registry = new StreamRegistry()
  const { id } = registry.create()
  registry.dispose(id)
  assert.doesNotThrow(() => registry.dispose(id))
  assert.equal(registry.size(), 0)
})
