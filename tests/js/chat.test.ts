// 契约测试：把一段文本切成流式分块。
// 这里只描述「行为」——给定输入应得什么输出，不关心内部怎么实现。
// 跑法：node tests/js/all.test.ts（仓库所在目录禁止子进程，不能用 node --test）
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { splitIntoChunks } from '../../src/main/ai/domain/chat.ts'

test('空串切出空数组', () => {
  assert.deepEqual(splitIntoChunks('', 3), [])
})

test('文本短于块长度时不切分', () => {
  assert.deepEqual(splitIntoChunks('abc', 10), ['abc'])
})

test('按给定长度顺序切分', () => {
  assert.deepEqual(splitIntoChunks('你好世界', 2), ['你好', '世界'])
})

test('最后一块允许不足长度', () => {
  assert.deepEqual(splitIntoChunks('abcdefg', 3), ['abc', 'def', 'g'])
})

test('拼回去必须等于原文（无损）', () => {
  const text = 'PointStudio 是一个 AI 工作台，流式输出是地基。'
  for (const size of [1, 2, 3, 7, 100]) {
    assert.equal(splitIntoChunks(text, size).join(''), text)
  }
})

test('不切坏 emoji（按码点切，而不是 UTF-16 单元）', () => {
  assert.deepEqual(splitIntoChunks('😀😀', 1), ['😀', '😀'])
  assert.deepEqual(splitIntoChunks('a😀b', 2), ['a😀', 'b'])
})

test('块长度非法时抛出 RangeError', () => {
  assert.throws(() => splitIntoChunks('abc', 0), RangeError)
  assert.throws(() => splitIntoChunks('abc', -1), RangeError)
})
