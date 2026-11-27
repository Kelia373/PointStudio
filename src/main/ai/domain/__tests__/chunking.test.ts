// 契约测试：文本切块（RAG 的前置）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { chunkText, DEFAULT_CHUNK_CHARS } from '../chunking.ts'

test('空文本切出空数组', () => {
  assert.deepEqual(chunkText('', { maxChars: 100 }), [])
  assert.deepEqual(chunkText('   \n\n  ', { maxChars: 100 }), [])
})

test('短文本只有一块，且原文完整保留', () => {
  const chunks = chunkText('一句话。', { maxChars: 100 })
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0].text, '一句话。')
  assert.equal(chunks[0].index, 0)
})

test('按段落边界切分，且每块不超过上限', () => {
  const text = '第一段内容。\n\n第二段内容。\n\n第三段内容。'
  const chunks = chunkText(text, { maxChars: 12 })

  assert.ok(chunks.length > 1)
  for (const chunk of chunks) {
    assert.ok(Array.from(chunk.text).length <= 12, `块超长: ${chunk.text}`)
  }
})

test('不产生纯空白块', () => {
  const text = 'aaa\n\n\n   \n\nbbb'
  const chunks = chunkText(text, { maxChars: 5 })
  assert.ok(chunks.every((chunk) => chunk.text.trim() !== ''))
})

test('没有重叠时，按序拼接等于原文', () => {
  const text =
    'PointStudio 是一个 AI 工作台。它负责理解、规划、调用能力、产出结果。' +
    '\n\n计划必须有可判断的验收方式，否则执行阶段只能靠感觉。'
  const chunks = chunkText(text, { maxChars: 20 })

  assert.equal(
    chunks.map((chunk) => chunk.text).join(''),
    text,
    '切块不能丢字、不能重复'
  )
})

test('每块的 index 连续递增，位置信息可回指原文', () => {
  const text = 'a'.repeat(50)
  const chunks = chunkText(text, { maxChars: 10 })

  chunks.forEach((chunk, position) => {
    assert.equal(chunk.index, position)
    assert.equal(text.slice(chunk.start, chunk.end), chunk.text)
  })
})

test('超长段落也能被切分（不能因为找不到段落边界就整段吐出来）', () => {
  const text = '字'.repeat(100)
  const chunks = chunkText(text, { maxChars: 10 })
  assert.ok(chunks.length >= 10)
})

test('非法上限抛错，避免出现零长度块', () => {
  assert.throws(() => chunkText('abc', { maxChars: 0 }), RangeError)
  assert.throws(() => chunkText('abc', { maxChars: -5 }), RangeError)
})

test('默认上限存在且合理', () => {
  assert.ok(DEFAULT_CHUNK_CHARS >= 200 && DEFAULT_CHUNK_CHARS <= 2000)
})
