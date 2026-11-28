// 契约测试：删除助手时解绑所有引用它的会话。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { AssistantService } from '../assistantService.ts'
import { ConversationService } from '../conversationService.ts'
import { removeAssistantAndUnbind } from '../assistantCleanup.ts'
import type { Assistant } from '../../ai/domain/assistant.ts'
import type { Conversation, Message } from '../../ai/domain/conversation.ts'

async function withServices(
  run: (ctx: {
    assistants: AssistantService
    conversations: ConversationService
    assistantId: string
    conversationId: string
  }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-cleanup-'))
  let seq = 0
  const deps = { newId: () => `id-${++seq}`, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() }
  const assistants = new AssistantService(new JsonFileStore<Assistant>(join(dir, 'a.json')), deps)
  const conversations = new ConversationService(
    new JsonFileStore<Conversation>(join(dir, 'c.json')),
    new JsonFileStore<Message>(join(dir, 'm.json')),
    deps
  )
  try {
    const assistant = await assistants.create({ name: '要被删的' })
    if (!assistant.ok) throw new Error('assistant create failed')
    const conversation = await conversations.create({ assistantId: assistant.value.id })
    if (!conversation.ok) throw new Error('conversation create failed')

    await run({
      assistants,
      conversations,
      assistantId: assistant.value.id,
      conversationId: conversation.value.id
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('删除助手后，引用它的会话被解绑', async () => {
  await withServices(async ({ assistants, conversations, assistantId, conversationId }) => {
    assert.equal((await conversations.get(conversationId))?.assistantId, assistantId)

    const result = await removeAssistantAndUnbind(assistants, conversations, assistantId)
    assert.equal(result.ok, true)

    assert.equal((await conversations.get(conversationId))?.assistantId, null, '不该留下悬空引用')
    assert.deepEqual(await assistants.list(), [])
  })
})

test('不影响绑定到其他助手的会话', async () => {
  await withServices(async ({ assistants, conversations, assistantId }) => {
    const other = await assistants.create({ name: '另一个' })
    if (!other.ok) return
    const otherConversation = await conversations.create({ assistantId: other.value.id })
    if (!otherConversation.ok) return

    await removeAssistantAndUnbind(assistants, conversations, assistantId)

    assert.equal((await conversations.get(otherConversation.value.id))?.assistantId, other.value.id)
    assert.equal((await assistants.list()).length, 1)
  })
})

test('助手不存在时返回 E_NOT_FOUND，且不改动任何会话', async () => {
  await withServices(async ({ assistants, conversations, conversationId }) => {
    const result = await removeAssistantAndUnbind(assistants, conversations, 'missing')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_NOT_FOUND'))
    }
    assert.ok((await conversations.get(conversationId))?.assistantId, '原有绑定不能被误清')
  })
})

test('删除助手时连带清掉主聊天的 isHome，不留悬挂标记', async () => {
  await withServices(async ({ assistants, conversations, assistantId }) => {
    const home = await conversations.create({
      assistantId,
      isHome: true,
      title: 'A · 主聊天'
    })
    assert.equal(home.ok, true)
    if (!home.ok) return

    const removed = await removeAssistantAndUnbind(assistants, conversations, assistantId)
    assert.equal(removed.ok, true)

    const saved = (await conversations.list()).find((item) => item.id === home.value.id)
    assert.equal(saved?.assistantId, null)
    assert.equal(saved?.isHome, undefined, '解绑后不得保留 isHome')
  })
})
