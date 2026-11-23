// 契约测试：一次问答的落库编排（用户消息 → 流式回复 → 助手消息）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { ConversationService } from '../conversationService.ts'
import { streamAssistantReply, type AssistantLookup } from '../chatFlow.ts'
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
  run: (ctx: {
    conversations: ConversationService
    conversationId: string
    assistants: AssistantLookup
  }) => Promise<void>,
  assistants: AssistantLookup = { get: async () => null },
  bindAssistantId: string | null = null
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-flow-'))
  let seq = 0
  const conversations = new ConversationService(
    new JsonFileStore<Conversation>(join(dir, 'conversations.json')),
    new JsonFileStore<Message>(join(dir, 'messages.json')),
    { newId: () => `id-${++seq}`, now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() }
  )
  try {
    const created = await conversations.create({ assistantId: bindAssistantId })
    if (!created.ok) throw new Error('create failed')
    await run({ conversations, conversationId: created.value.id, assistants })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('一次问答后，会话里留下用户与助手两条消息', async () => {
  await withFlow(async ({ conversations, conversationId, assistants }) => {
    const chunks: string[] = []
    for await (const chunk of streamAssistantReply(conversationId, '打个招呼', {
      conversations,
      assistants,
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
  await withFlow(async ({ conversations, conversationId, assistants }) => {
    let text = ''
    for await (const chunk of streamAssistantReply(conversationId, '你好', {
      conversations,
      assistants,
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
  await withFlow(async ({ conversations, conversationId, assistants }) => {
    await assert.rejects(async () => {
      for await (const _chunk of streamAssistantReply(conversationId, '会失败', {
        conversations,
        assistants,
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
  await withFlow(async ({ conversations, assistants }) => {
    await assert.rejects(async () => {
      for await (const _chunk of streamAssistantReply('missing', '你好', {
        conversations,
        assistants,
        engine: { provider: makeProvider(['x']), apiKey: 'k', baseUrl: 'x', model: 'm' }
      })) {
        // 不该有内容
      }
    })

    assert.deepEqual(await conversations.listMessages('missing'), [])
  })
})

test('会话绑定助手后，system prompt 与绑定模型真的生效', async () => {
  const seen: { system?: string; model?: string } = {}
  const assistantLookup: AssistantLookup = {
    get: async () => ({
      id: 'a-1',
      name: '代码审查员',
      systemPrompt: '你是严格的代码审查员',
      providerId: null,
      modelId: 'deepseek-reasoner',
      params: { temperature: 0.1, maxTokens: 1024, topP: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  }
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      seen.system = request.messages.find((m) => m.role === 'system')?.content
      seen.model = request.model
      yield '好'
    }
  }

  await withFlow(
    async ({ conversations, conversationId, assistants }) => {
      for await (const _chunk of streamAssistantReply(conversationId, '看看这段', {
        conversations,
        assistants,
        engine: { provider, apiKey: 'k', baseUrl: 'b', model: 'default-model' }
      })) {
        // 消费即可
      }
      assert.equal(seen.system, '你是严格的代码审查员')
      assert.equal(seen.model, 'deepseek-reasoner')
    },
    assistantLookup,
    'a-1'
  )
})

test('绑定的助手已被删除时降级为裸对话，不报错', async () => {
  const seen: { hasSystem: boolean } = { hasSystem: true }
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      seen.hasSystem = request.messages.some((m) => m.role === 'system')
      yield '好'
    }
  }

  await withFlow(
    async ({ conversations, conversationId, assistants }) => {
      let text = ''
      for await (const chunk of streamAssistantReply(conversationId, '你好', {
        conversations,
        assistants,
        engine: { provider, apiKey: 'k', baseUrl: 'b', model: 'm' }
      })) {
        text += chunk
      }
      assert.equal(text, '好')
      assert.equal(seen.hasSystem, false)
    },
    { get: async () => null }
  )
})
