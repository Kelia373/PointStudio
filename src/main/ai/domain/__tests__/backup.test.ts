// 契约测试：备份文档的构造与解析（版本、结构、失败不落地）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BACKUP_VERSION,
  createBackup,
  parseBackup,
  summarizeBackup
} from '../backup.ts'
import type { Assistant } from '../assistant.ts'
import type { Conversation, Message } from '../conversation.ts'

const NOW = '2026-01-01T00:00:00.000Z'

function sampleConversation(id = 'c-1'): Conversation {
  return {
    id,
    title: '会话',
    assistantId: null,
    createdAt: NOW,
    updatedAt: NOW
  }
}

function sampleMessage(id = 'm-1', conversationId = 'c-1'): Message {
  return {
    id,
    conversationId,
    role: 'user',
    content: '你好',
    status: 'complete',
    createdAt: NOW,
    updatedAt: NOW
  }
}

function sampleAssistant(id = 'a-1'): Assistant {
  return {
    id,
    name: '助手',
    systemPrompt: '你是助手',
    providerId: null,
    modelId: null,
    params: { temperature: 0.7, maxTokens: 100, topP: 1 },
    createdAt: NOW,
    updatedAt: NOW
  }
}

test('导出文档带版本与时间，三类数据齐全', () => {
  const doc = createBackup(
    { conversations: [sampleConversation()], messages: [sampleMessage()], assistants: [sampleAssistant()] },
    { now: NOW }
  )

  assert.equal(doc.version, BACKUP_VERSION)
  assert.equal(doc.exportedAt, NOW)
  assert.equal(doc.conversations.length, 1)
  assert.equal(doc.messages.length, 1)
  assert.equal(doc.assistants.length, 1)
})

test('导出→解析往返一致', () => {
  const doc = createBackup(
    { conversations: [sampleConversation()], messages: [sampleMessage()], assistants: [] },
    { now: NOW }
  )
  const parsed = parseBackup(JSON.stringify(doc))

  assert.equal(parsed.ok, true)
  if (parsed.ok) {
    assert.deepEqual(parsed.value, doc)
  }
})

test('版本不匹配时拒绝（未来版本不能被旧程序读坏）', () => {
  const doc = { ...createBackup({ conversations: [], messages: [], assistants: [] }, { now: NOW }), version: 99 }
  const parsed = parseBackup(JSON.stringify(doc))

  assert.equal(parsed.ok, false)
  if (!parsed.ok) {
    assert.ok(parsed.errors.includes('E_BACKUP_VERSION'))
  }
})

test('缺少数组或不是 JSON 时拒绝', () => {
  for (const text of ['不是 json', '{}', '{"version":1,"conversations":[]}']) {
    const parsed = parseBackup(text)
    assert.equal(parsed.ok, false, text)
  }
})

test('条目缺关键字段时拒绝，不放进半成品', () => {
  const broken = {
    version: BACKUP_VERSION,
    exportedAt: NOW,
    conversations: [{ id: 'c-1' }],
    messages: [],
    assistants: []
  }
  const parsed = parseBackup(JSON.stringify(broken))

  assert.equal(parsed.ok, false)
  if (!parsed.ok) {
    assert.ok(parsed.errors.includes('E_BACKUP_SHAPE'))
  }
})

test('汇总数量用于恢复前提示用户', () => {
  const doc = createBackup(
    {
      conversations: [sampleConversation('c-1'), sampleConversation('c-2')],
      messages: [sampleMessage()],
      assistants: [sampleAssistant()]
    },
    { now: NOW }
  )

  assert.deepEqual(summarizeBackup(doc), { conversations: 2, messages: 1, assistants: 1 })
})
