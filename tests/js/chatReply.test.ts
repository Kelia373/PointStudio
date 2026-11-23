// 契约测试：假流式回复的内容生成。
// 这一层是「业务」，所以断言业务行为：回显、无损、块大小、空输入不崩。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  REPLY_CHUNK_SIZE,
  buildReplyChunks,
  buildReplyText
} from '../../src/main/services/chatReply.ts'

test('回复文本回显用户输入', () => {
  assert.match(buildReplyText('你好'), /你好/)
})

test('分块拼回去等于完整回复文本（无损）', () => {
  const prompt = '帮我把这段设计文档拆成计划步骤'
  assert.equal(buildReplyChunks(prompt).join(''), buildReplyText(prompt))
})

test('每块不超过约定的码点数', () => {
  for (const chunk of buildReplyChunks('PointStudio 流式输出地基')) {
    assert.ok(Array.from(chunk).length <= REPLY_CHUNK_SIZE, `块过长: ${chunk}`)
  }
})

test('空输入不抛异常，且仍返回可显示的回复', () => {
  assert.ok(buildReplyText('   ').trim().length > 0)
  assert.ok(buildReplyChunks('   ').length > 0)
})

test('长输入被完整回显，不被截断', () => {
  const long = '甲'.repeat(200)
  assert.ok(buildReplyText(long).includes(long))
})
