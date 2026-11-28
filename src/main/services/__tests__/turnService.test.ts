// 契约测试：删除一整轮对话（用户消息 + 其后的助手回复）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { ConversationService } from '../conversationService.ts'
import { branchConversation, copyMessageText, deleteTurn, truncateFrom } from '../turnService.ts'
import { DEFAULT_ASSISTANT_ID } from '../../ai/domain/assistant.ts'
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

test('truncateFrom：删第 2 轮用户消息，后续全清，前面保留', async () => {
  await withTurns(async ({ service, conversationId, ids }) => {
    const result = await truncateFrom(service, conversationId, ids[2])
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.removed, 2)
    }
    const left = await service.listMessages(conversationId)
    assert.deepEqual(left.map((item) => item.content), ['第一问', '第一答'])

    const missing = await truncateFrom(service, conversationId, 'no-such-id')
    assert.equal(missing.ok, false)
    assert.equal((await service.listMessages(conversationId)).length, 2)
  })
})

test('branchConversation：从第 2 条分叉，源不变，新会话独立拥有前两条', async () => {
  await withTurns(async ({ service, conversationId, ids }) => {
    const result = await branchConversation(service, {
      conversationId,
      upToMessageId: ids[1]
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.notEqual(result.value.id, conversationId)
    assert.equal((await service.listMessages(conversationId)).length, 4)
    const copied = await service.listMessages(result.value.id)
    assert.deepEqual(copied.map((item) => item.content), ['第一问', '第一答'])
    assert.equal(copied.some((item) => ids.includes(item.id)), false, '消息 ID 必须独立')
  })
})

test('branchConversation：主聊天分叉为同 Agent 专题，绝不抢占 isHome', async () => {
  await withTurns(async ({ service }) => {
    const home = await service.create({ assistantId: 'a1', isHome: true, title: 'A · 主聊天' })
    assert.equal(home.ok, true)
    if (!home.ok) return
    const added = await service.appendMessage(home.value.id, { role: 'user', content: 'hi' })
    assert.equal(added.ok, true)
    if (!added.ok) return

    const branched = await branchConversation(service, {
      conversationId: home.value.id,
      upToMessageId: added.value.id
    })
    assert.equal(branched.ok, true)
    if (!branched.ok) return
    assert.equal(branched.value.assistantId, 'a1')
    assert.equal(branched.value.isHome, undefined)
    const source = await service.get(home.value.id)
    assert.equal(source?.isHome, true)
  })
})

test('branchConversation：自由对话继承模型参数，小组分叉落自由对话，标题不超 30 字', async () => {
  await withTurns(async ({ service }) => {
    const free = await service.create({ title: '这是一个非常非常非常非常非常非常非常长的会话标题' })
    assert.equal(free.ok, true)
    if (!free.ok) return
    await service.setModel(free.value.id, {
      model: 'deepseek-chat',
      providerId: 'deepseek',
      params: { temperature: 0.3 }
    })
    const first = await service.appendMessage(free.value.id, { role: 'user', content: 'q' })
    assert.equal(first.ok, true)
    if (!first.ok) return
    const branched = await branchConversation(service, {
      conversationId: free.value.id,
      upToMessageId: first.value.id
    })
    assert.equal(branched.ok, true)
    if (!branched.ok) return
    assert.equal(branched.value.assistantId, null)
    assert.equal(branched.value.model, 'deepseek-chat')
    assert.equal(branched.value.providerId, 'deepseek')
    assert.equal(branched.value.params?.temperature, 0.3)
    assert.ok(Array.from(branched.value.title).length <= 30)

    const group = await service.create({
      title: '小组会话',
      assistantId: 'a1',
      groupId: 'g1'
    })
    assert.equal(group.ok, true)
    if (!group.ok) return
    const msg = await service.appendMessage(group.value.id, { role: 'user', content: 'q' })
    assert.equal(msg.ok, true)
    if (!msg.ok) return
    const fromGroup = await branchConversation(service, {
      conversationId: group.value.id,
      upToMessageId: msg.value.id
    })
    assert.equal(fromGroup.ok, true)
    if (fromGroup.ok) {
      assert.equal(fromGroup.value.assistantId, null)
      assert.equal(fromGroup.value.groupId, null)
    }
  })
})

test('分叉带 adoptTo：小组 / 无主会话落到通用助手专题', async () => {
  await withTurns(async ({ service }) => {
    const free = await service.create({ title: '无主会话' })
    assert.equal(free.ok, true)
    if (!free.ok) return
    const msg = await service.appendMessage(free.value.id, { role: 'user', content: 'hi' })
    assert.equal(msg.ok, true)
    if (!msg.ok) return

    const branched = await branchConversation(
      service,
      { conversationId: free.value.id, upToMessageId: msg.value.id },
      { adoptTo: DEFAULT_ASSISTANT_ID }
    )
    assert.equal(branched.ok, true)
    if (!branched.ok) return
    assert.equal(branched.value.assistantId, DEFAULT_ASSISTANT_ID)
    assert.equal(branched.value.groupId, null)
    assert.equal(branched.value.isHome, undefined)

    const group = await service.create({ title: '小组', assistantId: 'a1', groupId: 'g1' })
    assert.equal(group.ok, true)
    if (!group.ok) return
    const groupMsg = await service.appendMessage(group.value.id, { role: 'user', content: 'hi' })
    assert.equal(groupMsg.ok, true)
    if (!groupMsg.ok) return
    const fromGroup = await branchConversation(
      service,
      { conversationId: group.value.id, upToMessageId: groupMsg.value.id },
      { adoptTo: DEFAULT_ASSISTANT_ID }
    )
    assert.equal(fromGroup.ok, true)
    if (fromGroup.ok) {
      assert.equal(fromGroup.value.assistantId, DEFAULT_ASSISTANT_ID)
      assert.equal(fromGroup.value.groupId, null)
    }
  })
})

test('分叉复制保留归因：历史回复不因分叉退化成中性标', async () => {
  await withTurns(async ({ service }) => {
    const source = await service.create({ assistantId: 'a1', title: '源会话' })
    assert.equal(source.ok, true)
    if (!source.ok) return

    const user = await service.appendMessage(source.value.id, { role: 'user', content: '问' })
    const reply = await service.appendMessage(source.value.id, {
      role: 'assistant',
      content: '答',
      assistantId: 'a1',
      providerId: 'deepseek',
      modelId: 'deepseek-chat'
    })
    assert.equal(user.ok && reply.ok, true)
    if (!user.ok || !reply.ok) return

    const branched = await branchConversation(service, {
      conversationId: source.value.id,
      upToMessageId: reply.value.id
    })
    assert.equal(branched.ok, true)
    if (!branched.ok) return

    const copied = await service.listMessages(branched.value.id)
    const assistant = copied.find((message) => message.role === 'assistant')
    assert.equal(assistant?.assistantId, 'a1')
    assert.equal(assistant?.providerId, 'deepseek')
    assert.equal(assistant?.modelId, 'deepseek-chat')
  })
})
