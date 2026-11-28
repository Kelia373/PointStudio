// 契约测试：会话四路分桶与主聊天查找。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ConversationDto } from '../../../../shared/types/ipc.ts'
import {
  findAgentHomeConversation,
  partitionConversations
} from '../conversationBuckets.ts'

function conversation(
  id: string,
  overrides: Partial<ConversationDto> = {}
): ConversationDto {
  return {
    id,
    title: id,
    assistantId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

const agents = [{ id: 'a1' }, { id: 'a2' }]

test('四路精确分桶：自由 / 主聊天 / 专题 / 小组', () => {
  const conversations = [
    conversation('free-1', { assistantId: null }),
    conversation('home-a1', { assistantId: 'a1', isHome: true }),
    conversation('topic-a1', { assistantId: 'a1' }),
    conversation('home-a2', { assistantId: 'a2', isHome: true }),
    conversation('group-1', { assistantId: 'a1', groupId: 'g1', isHome: false })
  ]
  const buckets = partitionConversations(conversations, agents)
  assert.deepEqual(buckets.freeChats.map((item) => item.id), ['free-1'])
  assert.equal(buckets.agentHomeById.a1?.id, 'home-a1')
  assert.equal(buckets.agentHomeById.a2?.id, 'home-a2')
  assert.deepEqual(buckets.agentTopicsById.a1?.map((item) => item.id), ['topic-a1'])
  assert.deepEqual(buckets.groupChatsById.g1?.map((item) => item.id), ['group-1'])
})

test('指向不存在 Agent 的孤儿会话归入自由对话，不丢', () => {
  const buckets = partitionConversations(
    [conversation('orphan', { assistantId: 'gone' })],
    agents
  )
  assert.deepEqual(buckets.freeChats.map((item) => item.id), ['orphan'])
  assert.equal(buckets.agentTopicsById.gone, undefined)
})

test('同一 Agent 多条无 isHome 历史全部保留，按 updatedAt 倒序', () => {
  const buckets = partitionConversations(
    [
      conversation('old', { assistantId: 'a1', updatedAt: '2026-01-01T00:00:00.000Z' }),
      conversation('new', { assistantId: 'a1', updatedAt: '2026-03-01T00:00:00.000Z' }),
      conversation('mid', { assistantId: 'a1', updatedAt: '2026-02-01T00:00:00.000Z' })
    ],
    agents
  )
  assert.deepEqual(
    buckets.agentTopicsById.a1.map((item) => item.id),
    ['new', 'mid', 'old']
  )
  assert.equal(buckets.agentHomeById.a1, undefined)
})

test('同一 Agent 出现两条 isHome 时取最新，旧的一条降级为专题', () => {
  const buckets = partitionConversations(
    [
      conversation('home-old', {
        assistantId: 'a1',
        isHome: true,
        updatedAt: '2026-01-01T00:00:00.000Z'
      }),
      conversation('home-new', {
        assistantId: 'a1',
        isHome: true,
        updatedAt: '2026-02-01T00:00:00.000Z'
      })
    ],
    agents
  )
  assert.equal(buckets.agentHomeById.a1?.id, 'home-new')
  assert.deepEqual(buckets.agentTopicsById.a1.map((item) => item.id), ['home-old'])
})

test('findAgentHomeConversation 忽略小组会话与别人的会话', () => {
  const conversations = [
    conversation('home-a1', { assistantId: 'a1', isHome: true }),
    conversation('group-home', {
      assistantId: 'a1',
      groupId: 'g1',
      isHome: true,
      updatedAt: '2026-05-01T00:00:00.000Z'
    }),
    conversation('home-a2', { assistantId: 'a2', isHome: true })
  ]
  assert.equal(findAgentHomeConversation('a1', conversations)?.id, 'home-a1')
  assert.equal(findAgentHomeConversation('a3', conversations), null)
})

test('空输入返回空桶，不抛错', () => {
  const buckets = partitionConversations([], agents)
  assert.deepEqual(buckets.freeChats, [])
  assert.deepEqual(buckets.agentTopicsById, {})
  assert.deepEqual(buckets.groupChatsById, {})
})
