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

test('第二轮请求会带上第一轮的历史（多轮真的有记忆）', async () => {
  const requests: ChatStreamRequest[] = []
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      requests.push(request)
      yield '答'
    }
  }

  await withFlow(async ({ conversations, conversationId, assistants }) => {
    const flowDeps = {
      conversations,
      assistants,
      engine: { provider, apiKey: 'k', baseUrl: 'b', model: 'm' }
    }
    for await (const _chunk of streamAssistantReply(conversationId, '第一问', flowDeps)) {
      // 消费
    }
    for await (const _chunk of streamAssistantReply(conversationId, '第二问', flowDeps)) {
      // 消费
    }

    assert.equal(requests.length, 2)
    assert.deepEqual(requests[0].messages, [{ role: 'user', content: '第一问' }])
    assert.deepEqual(
      requests[1].messages,
      [
        { role: 'user', content: '第一问' },
        { role: 'assistant', content: '答' },
        { role: 'user', content: '第二问' }
      ],
      '第二轮要带上第一轮的问与答，且本轮的输入只出现一次'
    )
  })
})

test('上下文超限时回调丢了几条，而不是静默丢弃', async () => {
  let dropped = 0
  await withFlow(async ({ conversations, conversationId, assistants }) => {
    const provider: ChatProvider = {
      id: 'fake',
      async *streamChat(): AsyncGenerator<string> {
        yield '答'
      }
    }
    const deps = {
      conversations,
      assistants,
      engine: { provider, apiKey: 'k', baseUrl: 'b', model: 'm' },
      contextLimits: { maxMessages: 1, maxTokens: 10_000 },
      onContextTrimmed: (count: number) => {
        dropped = count
      }
    }

    for await (const _chunk of streamAssistantReply(conversationId, '第一问', deps)) {
      // 消费
    }
    for await (const _chunk of streamAssistantReply(conversationId, '第二问', deps)) {
      // 消费
    }

    assert.equal(dropped, 1, '第二轮历史有 2 条，上限 1 条，应丢 1 条')
  })
})

test('注入检索时，命中片段进入请求并回调引用', async () => {
  const seen: ChatStreamRequest[] = []
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      seen.push(request)
      yield '答'
    }
  }
  let notified = 0

  await withFlow(async ({ conversations, conversationId, assistants }) => {
    for await (const _chunk of streamAssistantReply(conversationId, '工作台是什么', {
      conversations,
      assistants,
      engine: { provider, apiKey: 'k', baseUrl: 'b', model: 'm' },
      retrieval: {
        search: async () => [
          { chunk: { id: 'a.md#0', text: 'PointStudio 是 AI 工作台', source: 'a.md' }, score: 3, matchedTerms: ['工作'] }
        ]
      },
      onReferences: () => {
        notified += 1
      }
    })) {
      // 消费
    }
  })

  const userMessage = seen[0].messages.at(-1)
  assert.ok(userMessage?.content.includes('a.md'), '参考片段的来源要进请求')
  assert.ok(userMessage?.content.includes('工作台是什么'))
  assert.equal(notified, 1)
})

test('检索失败不影响回答（降级为无参考资料）', async () => {
  const seen: ChatStreamRequest[] = []
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      seen.push(request)
      yield '答'
    }
  }

  await withFlow(async ({ conversations, conversationId, assistants }) => {
    let text = ''
    for await (const chunk of streamAssistantReply(conversationId, '问题', {
      conversations,
      assistants,
      engine: { provider, apiKey: 'k', baseUrl: 'b', model: 'm' },
      retrieval: {
        search: async () => {
          throw new Error('E_INDEX_BROKEN')
        }
      }
    })) {
      text += chunk
    }
    assert.equal(text, '答')
  })

  assert.deepEqual(seen[0].messages.at(-1), { role: 'user', content: '问题' })
})

test('检索命中时，助手消息会记下引用来源', async () => {
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(): AsyncGenerator<string> {
      yield '答'
    }
  }

  await withFlow(async ({ conversations, conversationId, assistants }) => {
    for await (const _chunk of streamAssistantReply(conversationId, '工作台是什么', {
      conversations,
      assistants,
      engine: { provider, apiKey: 'k', baseUrl: 'b', model: 'm' },
      retrieval: {
        search: async () => [
          { chunk: { id: 'a.md#0', text: '工作台', source: 'a.md' }, score: 3, matchedTerms: ['工作'] },
          { chunk: { id: 'b.md#1', text: '工作台', source: 'b.md' }, score: 2, matchedTerms: ['工作'] }
        ]
      }
    })) {
      // 消费
    }

    const messages = await conversations.listMessages(conversationId)
    const assistant = messages.find((message) => message.role === 'assistant')
    assert.deepEqual(assistant?.references, [
      { chunkId: 'a.md#0', source: 'a.md' },
      { chunkId: 'b.md#1', source: 'b.md' }
    ])
  })
})

test('没有检索命中时，助手消息不带引用字段', async () => {
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(): AsyncGenerator<string> {
      yield '答'
    }
  }

  await withFlow(async ({ conversations, conversationId, assistants }) => {
    for await (const _chunk of streamAssistantReply(conversationId, '问题', {
      conversations,
      assistants,
      engine: { provider, apiKey: 'k', baseUrl: 'b', model: 'm' }
    })) {
      // 消费
    }

    const messages = await conversations.listMessages(conversationId)
    const assistant = messages.find((message) => message.role === 'assistant')
    assert.equal(assistant?.references, undefined)
  })
})

test('跨服务商路由：Agent A 走 DeepSeek、Agent B 走 OpenCode Go，各自命中凭据并记账', async () => {
  const seen: Array<{ providerId: string; apiKey: string; baseUrl: string; model: string; sessionId?: string }> = []
  const usage: Array<{ providerId: string; modelId: string; assistantId: string | null }> = []

  const assistants: AssistantLookup = {
    get: async (id) =>
      id === 'agent-a'
        ? {
            id: 'agent-a',
            name: 'A',
            systemPrompt: '',
            providerId: 'deepseek',
            modelId: 'deepseek-chat',
            params: { temperature: 0.7, maxTokens: 1024, topP: 1 },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
        : {
            id: 'agent-b',
            name: 'B',
            systemPrompt: '',
            providerId: 'opencode-go',
            modelId: 'kimi-k2.5',
            params: { temperature: 0.7, maxTokens: 1024, topP: 1 },
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z'
          }
  }

  const provider: ChatProvider = {
    id: 'default',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      const providerId = request.baseUrl.includes('opencode') ? 'opencode-go' : 'deepseek'
      seen.push({
        providerId,
        apiKey: request.apiKey,
        baseUrl: request.baseUrl,
        model: request.model,
        ...(request.sessionId ? { sessionId: request.sessionId } : {})
      })
      request.onUsage?.({
        promptTokens: 7,
        completionTokens: 3,
        totalTokens: 10,
        cacheHitTokens: 1
      })
      yield 'ok'
    }
  }

  const accounts: Record<string, { provider: ChatProvider; providerId: string; apiKey: string; baseUrl: string; model: string }> = {
    deepseek: {
      provider,
      providerId: 'deepseek',
      apiKey: 'sk-ds-test',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat'
    },
    'opencode-go': {
      provider,
      providerId: 'opencode-go',
      apiKey: 'oc_sk_test',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      model: 'kimi-k2.5'
    }
  }

  const engine = {
    provider,
    apiKey: null,
    baseUrl: 'https://default',
    model: 'default-model',
    resolveAccount: async (providerId?: string | null) =>
      (providerId && accounts[providerId]) || null
  }

  const runAgent = async (assistantId: string): Promise<void> => {
    await withFlow(
      async ({ conversations, conversationId }) => {
        for await (const _chunk of streamAssistantReply(conversationId, 'hi', {
          conversations,
          assistants,
          engine,
          onUsageRecorded: (record) => {
            usage.push({
              providerId: record.providerId,
              modelId: record.modelId,
              assistantId: record.assistantId
            })
          }
        })) {
          // 消费流
        }
        const conversation = await conversations.get(conversationId)
        assert.equal(conversation?.assistantId, assistantId)
      },
      assistants,
      assistantId
    )
  }

  await runAgent('agent-a')
  await runAgent('agent-b')

  assert.equal(seen.length, 2)
  assert.deepEqual(
    seen.map((item) => [item.providerId, item.apiKey, item.model]),
    [
      ['deepseek', 'sk-ds-test', 'deepseek-chat'],
      ['opencode-go', 'oc_sk_test', 'kimi-k2.5']
    ]
  )
  assert.equal(seen[1].baseUrl, 'https://opencode.ai/inference/go/openai/v1')
  assert.ok(seen.every((item) => typeof item.sessionId === 'string' && item.sessionId.length > 0))
  assert.deepEqual(usage, [
    { providerId: 'deepseek', modelId: 'deepseek-chat', assistantId: 'agent-a' },
    { providerId: 'opencode-go', modelId: 'kimi-k2.5', assistantId: 'agent-b' }
  ])
})

test('会话级模型与服务商覆盖优先于助手绑定', async () => {
  const seen: Array<{ model: string; baseUrl: string }> = []
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      seen.push({ model: request.model, baseUrl: request.baseUrl })
      yield 'x'
    }
  }
  const assistants: AssistantLookup = {
    get: async () => ({
      id: 'a1',
      name: 'A',
      systemPrompt: '',
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      params: { temperature: 0.7, maxTokens: 1024, topP: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  }
  await withFlow(
    async ({ conversations, conversationId }) => {
      const patched = await conversations.setModel(conversationId, {
        model: 'claude-sonnet-4-5',
        providerId: 'opencode-go'
      })
      assert.equal(patched.ok, true)
      for await (const _chunk of streamAssistantReply(conversationId, 'hi', {
        conversations,
        assistants,
        engine: {
          provider,
          apiKey: null,
          baseUrl: 'https://default',
          model: 'default',
          resolveAccount: async (providerId) =>
            providerId === 'opencode-go'
              ? {
                  provider,
                  providerId: 'opencode-go',
                  apiKey: 'oc_sk_test',
                  baseUrl: 'https://opencode.ai/inference/go/openai/v1',
                  model: 'kimi-k2.5'
                }
              : null
        }
      })) {
        // 消费流
      }
    },
    assistants,
    'a1'
  )
  assert.deepEqual(seen, [
    { model: 'claude-sonnet-4-5', baseUrl: 'https://opencode.ai/inference/go/openai/v1' }
  ])
})

test('群聊 @ 成员：assistantOverride 让本轮由被 @ 的 Agent 接管并记账', async () => {
  const seen: string[] = []
  const usage: Array<string | null> = []
  const lookup: AssistantLookup = {
    get: async (id) => ({
      id,
      name: id,
      systemPrompt: '',
      providerId: 'deepseek',
      modelId: id === 'agent-b' ? 'deepseek-reasoner' : 'deepseek-chat',
      params: { temperature: 0.7, maxTokens: 1024, topP: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  }
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      seen.push(request.model)
      request.onUsage?.({
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        cacheHitTokens: 0
      })
      yield 'ok'
    }
  }
  await withFlow(
    async ({ conversations, conversationId }) => {
      for await (const _chunk of streamAssistantReply(conversationId, 'hi', {
        conversations,
        assistants: lookup,
        engine: { provider, apiKey: 'k', baseUrl: 'x', model: 'deepseek-chat' },
        assistantOverride: 'agent-b',
        onUsageRecorded: (record) => {
          usage.push(record.assistantId)
        }
      })) {
        // 消费
      }
    },
    lookup,
    'agent-a'
  )
  assert.deepEqual(seen, ['deepseek-reasoner'])
  assert.deepEqual(usage, ['agent-b'])
})

test('@ 停用的成员时回落会话绑定的组长', async () => {
  const seen: string[] = []
  const usage: Array<string | null> = []
  const lookup: AssistantLookup = {
    get: async (id) => ({
      id,
      name: id,
      systemPrompt: '',
      providerId: 'deepseek',
      modelId: id === 'agent-b' ? 'deepseek-reasoner' : 'deepseek-chat',
      enabled: id !== 'agent-b',
      params: { temperature: 0.7, maxTokens: 1024, topP: 1 },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z'
    })
  }
  const provider: ChatProvider = {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      seen.push(request.model)
      request.onUsage?.({
        promptTokens: 1,
        completionTokens: 1,
        totalTokens: 2,
        cacheHitTokens: 0
      })
      yield 'ok'
    }
  }
  await withFlow(
    async ({ conversations, conversationId }) => {
      for await (const _chunk of streamAssistantReply(conversationId, 'hi', {
        conversations,
        assistants: lookup,
        engine: { provider, apiKey: 'k', baseUrl: 'x', model: 'deepseek-chat' },
        assistantOverride: 'agent-b',
        onUsageRecorded: (record) => {
          usage.push(record.assistantId)
        }
      })) {
        // 消费
      }
    },
    lookup,
    'agent-a'
  )
  assert.deepEqual(seen, ['deepseek-chat'])
  assert.deepEqual(usage, ['agent-a'])
})
