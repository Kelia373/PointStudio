// 契约测试：一次问答的落库编排（用户消息 → 流式回复 → 助手消息）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { ConversationService } from '../conversationService.ts'
import { streamAssistantReply } from '../chatFlow.ts'
import type { Conversation, Message } from '../../ai/domain/conversation.ts'
import type { ChatProvider, ChatStreamRequest } from '../../ai/providers/types.ts'

function makeProvider(chunks: string[], failAfter?: number): ChatProvider {
  return {
    id: 'fake',
    async *streamChat(_request: ChatStreamRequest): AsyncGenerator<string> {
      for (let i = 0; i < chunks.length; i++) {
        if (failAfter !== undefined && i === failAfter) {
          throw new Error('boom')
        }
        yield chunks[i]
      }
    }
  }
}

async function withFlow(
  run: (ctx: { conversations: ConversationService; conversationId: string }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-flow-'))
  let seq = 0
  const conversations = new ConversationService(
    new JsonFileStore<Conversation>(join(dir, 'conversations.json')),
    new JsonFileStore<Message>(join(dir, 'messages.json')),
    { newId: () => `id-${++seq}`, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() }
  )
  try {
    const created = await conversations.create({})
    if (!created.ok) throw new Error('create failed')
    await run({ conversations, conversationId: created.value.id })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('一次问答后，会话里留下用户与助手两条消息', async () => {
  await withFlow(async ({ conversations, conversationId }) => {
    const chunks: string[] = []
    for await (const chunk of streamAssistantReply(conversationId, '打个招呼', {
      conversations,
      engine: { provider: makeProvider(['你', '好']), apiKey: 'k', baseUrl: 'x', model: 'm' }
    })) {
      chunks.push(chunk)
    }

    assert.deepEqual(chunks, ['你', '好'])
    const messages = await conversations.listMessages(conversationId)
    assert.deepEqual(
      messages.map((m) => `${m.role}:${m.content}:${m.status}`),
      ['user:打个招呼:complete', 'assistant:你好:complete']
    )
  })
})

test('未配 Key 时走本地假流式，同样落库', async () => {
  await withFlow(async ({ conversations, conversationId }) => {
    let text = ''
    for await (const chunk of streamAssistantReply(conversationId, '你好', {
      conversations,
      engine: { provider: makeProvider([]), apiKey: null, baseUrl: 'x', model: 'm' }
    })) {
      text += chunk
    }

    assert.ok(text.length > 0)
    const messages = await conversations.listMessages(conversationId)
    assert.equal(messages.length, 2)
    assert.equal(messages[1].content, text)
  })
})

test('回复中途失败：用户消息保留，助手消息标记为 error', async () => {
  await withFlow(async ({ conversations, conversationId }) => {
    await assert.rejects(async () => {
      for await (const _chunk of streamAssistantReply(conversationId, '会失败', {
        conversations,
        engine: { provider: makeProvider(['半', '句'], 1), apiKey: 'k', baseUrl: 'x', model: 'm' }
      })) {
        // 消费到抛错为止
      }
    })

    const messages = await conversations.listMessages(conversationId)
    assert.equal(messages.length, 2)
    assert.equal(messages[0].role, 'user')
    assert.equal(messages[1].role, 'assistant')
    assert.equal(messages[1].status, 'error')
    assert.equal(messages[1].content, '半', '已产出的部分要保留，而不是丢掉')
  })
})

test('会话不存在时直接抛错，不产生任何消息', async () => {
  await withFlow(async ({ conversations }) => {
    await assert.rejects(async () => {
      for await (const _chunk of streamAssistantReply('missing', '你好', {
        conversations,
        engine: { provider: makeProvider(['x']), apiKey: 'k', baseUrl: 'x', model: 'm' }
      })) {
        // 不该有内容
      }
    })

    assert.deepEqual(await conversations.listMessages('missing'), [])
  })
})
