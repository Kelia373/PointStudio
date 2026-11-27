// 契约测试：删除一整轮对话（用户消息 + 其后的助手回复）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { ConversationService } from '../conversationService.ts'
import { deleteTurn, copyMessageText } from '../turnService.ts'
import type { Conversation, Message } from '../../ai/domain/conversation.ts'

async function withTurns(
  run: (ctx: { service: ConversationService; conversationId: string; ids: string[] }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-turn-'))
  let seq = 0
  const service = new ConversationService(
    new JsonFileStore<Conversation>(join(dir, 'c.json')),
    new JsonFileStore<Message>(join(dir, 'm.json')),
    { newId: () => `id-${++seq}`, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() }
  )
  try {
    const created = await service.create({ title: '会话' })
    if (!created.ok) throw new Error('create failed')
    const conversationId = created.value.id

    const ids: string[] = []
    for (const [role, content] of [
      ['user', '第一问'],
      ['assistant', '第一答'],
      ['user', '第二问'],
      ['assistant', '第二答']
    ] as const) {
      const added = await service.appendMessage(conversationId, { role, content })
      if (!added.ok) throw new Error('append failed')
      ids.push(added.value.id)
    }

    await run({ service, conversationId, ids })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('删除中间一轮：连带它的助手回复，前后两轮不受影响', async () => {
  await withTurns(async ({ service, conversationId, ids }) => {
    // ids: [问1, 答1, 问2, 答2]；删除「问1」应连带「答1」
    const result = await deleteTurn(service, conversationId, ids[0])

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.removed, 2)
    }
    const rest = await service.listMessages(conversationId)
    assert.deepEqual(
      rest.map((message) => message.content),
      ['第二问', '第二答']
    )
  })
})

test('删除最后一轮同样连带助手回复', async () => {
  await withTurns(async ({ service, conversationId, ids }) => {
    const result = await deleteTurn(service, conversationId, ids[2])
    assert.equal(result.ok, true)

    const rest = await service.listMessages(conversationId)
    assert.deepEqual(
      rest.map((message) => message.content),
      ['第一问', '第一答']
    )
  })
})

test('对助手消息调用时只删该条（不误删它对应的提问）', async () => {
  await withTurns(async ({ service, conversationId, ids }) => {
    const result = await deleteTurn(service, conversationId, ids[1])
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.removed, 1)
    }

    const rest = await service.listMessages(conversationId)
    assert.deepEqual(
      rest.map((message) => message.content),
      ['第一问', '第二问', '第二答']
    )
  })
})

test('消息不存在时返回 E_NOT_FOUND，不删任何东西', async () => {
  await withTurns(async ({ service, conversationId }) => {
    const result = await deleteTurn(service, conversationId, 'missing')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_NOT_FOUND'))
    }
    assert.equal((await service.listMessages(conversationId)).length, 4)
  })
})

test('复制消息文本：原样返回，不改动数据', async () => {
  await withTurns(async ({ service, conversationId, ids }) => {
    const text = await copyMessageText(service, conversationId, ids[0])
    assert.equal(text, '第一问')
    assert.equal((await service.listMessages(conversationId)).length, 4)
  })
})
