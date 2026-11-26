// 契约测试：流式 chunk 按帧合并，保证同一帧内多次 push 只刷新一次。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createRafBatcher } from '../rafBatcher.ts'

interface Harness {
  batcher: ReturnType<typeof createRafBatcher>
  tick: () => void
  flushes: Array<Map<string, string>>
  scheduled: () => number
}

function setup(): Harness {
  const flushes: Array<Map<string, string>> = []
  const queue: Array<() => void> = []
  let scheduleCount = 0
  const batcher = createRafBatcher({
    onFlush: (batched) => flushes.push(batched),
    schedule: (callback) => {
      scheduleCount += 1
      queue.push(callback)
      return scheduleCount
    }
  })
  const tick = (): void => {
    const pending = queue.splice(0, queue.length)
    for (const run of pending) run()
  }
  return { batcher, tick, flushes, scheduled: () => scheduleCount }
}

test('同一帧内连续 push 10 次，只 flush 一次且内容拼接完整', () => {
  const { batcher, tick, flushes, scheduled } = setup()

  for (let index = 0; index < 10; index += 1) {
    batcher.push('msg-1', `c${index}`)
  }

  assert.equal(flushes.length, 0, '帧回调前不应该刷新')
  // 关键：同一帧内只能预约一次调度，否则每来一个 chunk 都排一帧
  assert.equal(scheduled(), 1, '10 次 push 只应调度 1 次')
  tick()

  assert.equal(flushes.length, 1)
  assert.equal(flushes[0].get('msg-1'), 'c0c1c2c3c4c5c6c7c8c9')
})

test('flushNow 立即同步冲刷，之后帧回调不再重复触发', () => {
  const { batcher, tick, flushes } = setup()

  batcher.push('msg-1', 'a')
  batcher.push('msg-1', 'b')
  batcher.flushNow()

  assert.equal(flushes.length, 1)
  assert.equal(flushes[0].get('msg-1'), 'ab')

  tick()
  assert.equal(flushes.length, 1, '已冲刷的内容不能二次上报')
})

test('clear 丢弃该 id 的缓冲，其他 id 不受影响', () => {
  const { batcher, tick, flushes } = setup()

  batcher.push('msg-1', 'drop-me')
  batcher.push('msg-2', 'keep-me')
  batcher.clear('msg-1')
  tick()

  assert.equal(flushes.length, 1)
  assert.equal(flushes[0].has('msg-1'), false)
  assert.equal(flushes[0].get('msg-2'), 'keep-me')
})
