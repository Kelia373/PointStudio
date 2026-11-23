// 契约测试：按块序号在原文里定位片段（引用点击跳原文用）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { locateChunk, parseChunkId } from '../chunkLocator.ts'

test('解析块 id：path#index', () => {
  assert.deepEqual(parseChunkId('notes/a.md#0'), { path: 'notes/a.md', index: 0 })
  assert.deepEqual(parseChunkId('a#b#2'), { path: 'a#b', index: 2 })
})

test('非法块 id 返回 null', () => {
  for (const id of ['a.md', 'a.md#', 'a.md#x', 'a.md#-1', '#0', '']) {
    assert.equal(parseChunkId(id), null, id)
  }
})

test('定位到对应片段，且位置可回指原文', () => {
  const content = '第一段内容。'.repeat(3) + '第二段内容。'.repeat(3)
  const located = locateChunk(content, 1, 6)

  assert.ok(located)
  if (located) {
    assert.equal(content.slice(located.start, located.end), located.text)
    assert.ok(located.text.length > 0)
  }
})

test('第 0 块就是开头那段', () => {
  const content = 'abcdefghi'
  const located = locateChunk(content, 0, 4)
  assert.ok(located)
  if (located) {
    assert.equal(located.start, 0)
    assert.equal(located.text, content.slice(0, located.end))
  }
})

test('越界或空内容返回 null（而不是猜一个附近的）', () => {
  const content = 'abc'
  assert.equal(locateChunk(content, 5, 4), null)
  assert.equal(locateChunk('', 0, 4), null)
  assert.equal(locateChunk('   ', 0, 4), null)
})

test('参数非法时抛错，避免静默返回错块', () => {
  assert.throws(() => locateChunk('abc', -1, 4), RangeError)
  assert.throws(() => locateChunk('abc', 0, 0), RangeError)
})
