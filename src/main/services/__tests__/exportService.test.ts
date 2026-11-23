// 契约测试：会话导出为 Markdown（结构、引用、边界）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderConversationMarkdown } from '../exportService.ts'
import type { Conversation, Message } from '../../ai/domain/conversation.ts'

const NOW = '2026-01-01T00:00:00.000Z'

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return { id: 'c-1', title: '会话标题', assistantId: null, createdAt: NOW, updatedAt: NOW, ...overrides }
}

function message(overrides: Partial<Message> & { id: string }): Message {
  return {
    conversationId: 'c-1',
    role: 'user',
    content: '内容',
    status: 'complete',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  }
}

test('导出带标题与每轮问答，用户与助手区分开', () => {
  const markdown = renderConversationMarkdown(conversation(), [
    message({ id: 'm1', role: 'user', content: '你好' }),
    message({ id: 'm2', role: 'assistant', content: '在的' })
  ])

  assert.ok(markdown.startsWith('# 会话标题'))
  assert.ok(markdown.includes('你好'))
  assert.ok(markdown.includes('在的'))
  assert.ok(markdown.includes('**你**'))
  assert.ok(markdown.includes('**PointStudio**'))
})

test('消息顺序与传入顺序一致', () => {
  const markdown = renderConversationMarkdown(conversation(), [
    message({ id: 'm1', content: '第一句' }),
    message({ id: 'm2', role: 'assistant', content: '第二句' }),
    message({ id: 'm3', content: '第三句' })
  ])

  assert.ok(markdown.indexOf('第一句') < markdown.indexOf('第二句'))
  assert.ok(markdown.indexOf('第二句') < markdown.indexOf('第三句'))
})

test('引用来源以脚注形式附在该条消息下', () => {
  const markdown = renderConversationMarkdown(conversation(), [
    message({
      id: 'm1',
      role: 'assistant',
      content: '根据资料……',
      references: [
        { chunkId: 'a.md#0', source: 'a.md' },
        { chunkId: 'b.md#2', source: 'b.md' }
      ]
    })
  ])

  assert.ok(markdown.includes('a.md'))
  assert.ok(markdown.includes('b.md'))
  assert.ok(markdown.includes('引用'))
})

test('出错的消息被标注，不冒充正常回答', () => {
  const markdown = renderConversationMarkdown(conversation(), [
    message({ id: 'm1', role: 'assistant', content: '半句话', status: 'error' })
  ])

  assert.ok(markdown.includes('失败'))
})

test('空会话导出仍是有意义的文档（标题 + 说明）', () => {
  const markdown = renderConversationMarkdown(conversation(), [])
  assert.ok(markdown.startsWith('# 会话标题'))
  assert.ok(markdown.trim().length > '# 会话标题'.length, '不该只有一个标题')
})

test('内容里的 Markdown 特殊结构不被破坏（原样保留）', () => {
  const code = '```ts\nconst a = 1\n```'
  const markdown = renderConversationMarkdown(conversation(), [
    message({ id: 'm1', role: 'assistant', content: code })
  ])
  assert.ok(markdown.includes(code))
})
