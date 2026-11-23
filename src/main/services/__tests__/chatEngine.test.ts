// 契约测试：聊天引擎的「真模型 / 假流式」切换。
// 有 Key 走 provider，没 Key 走本地假回复——这条回退保证新人 clone 下来就能跑。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { resolveMode, streamReplyText } from '../chatEngine.ts'
import { buildReplyChunks } from '../chatReply.ts'
import { type ChatProvider, type ChatStreamRequest } from '../../ai/providers/types.ts'

function makeProvider(chunks: string[], spy?: { request?: ChatStreamRequest }): ChatProvider {
  return {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      if (spy) {
        spy.request = request
      }
      for (const chunk of chunks) {
        yield chunk
      }
    }
  }
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const item of stream) {
    out.push(item)
  }
  return out
}

test('没有 Key 时回退到本地假流式，不调用 provider', async () => {
  const spy: { request?: ChatStreamRequest } = {}
  const chunks = await collect(
    streamReplyText('你好', {
      provider: makeProvider(['不该出现'], spy),
      apiKey: null,
      baseUrl: 'https://example.invalid',
      model: 'whatever'
    })
  )

  assert.deepEqual(chunks, buildReplyChunks('你好'))
  assert.equal(spy.request, undefined, '无 Key 时不该发起任何请求')
})

test('有 Key 时走 provider，并透传模型与凭据', async () => {
  const spy: { request?: ChatStreamRequest } = {}
  const chunks = await collect(
    streamReplyText('你好', {
      provider: makeProvider(['你', '好'], spy),
      apiKey: 'k-1',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat'
    })
  )

  assert.deepEqual(chunks, ['你', '好'])
  assert.equal(spy.request?.apiKey, 'k-1')
  assert.equal(spy.request?.model, 'deepseek-chat')
  assert.equal(spy.request?.baseUrl, 'https://api.deepseek.com')
  assert.deepEqual(spy.request?.messages, [{ role: 'user', content: '你好' }])
})

test('provider 的异常原样上抛，由边界层统一归一', async () => {
  const failing: ChatProvider = {
    id: 'fake',
    // eslint 不存在，这里只是让 async generator 抛错
    async *streamChat(): AsyncGenerator<string> {
      throw new Error('boom')
      // 不可达，仅为让生成器类型成立
      yield ''
    }
  }

  await assert.rejects(async () =>
    collect(
      streamReplyText('你好', {
        provider: failing,
        apiKey: 'k-1',
        baseUrl: 'https://example.invalid',
        model: 'm'
      })
    )
  )
})

test('resolveMode 直接反映有没有可用凭据', () => {
  const base = { provider: makeProvider([]), baseUrl: 'x', model: 'm' }
  assert.equal(resolveMode({ ...base, apiKey: null }), 'local')
  assert.equal(resolveMode({ ...base, apiKey: '   ' }), 'local')
  assert.equal(resolveMode({ ...base, apiKey: 'k' }), 'live')
})

test('传了 systemPrompt 就把它放在消息最前面', async () => {
  const spy: { request?: ChatStreamRequest } = {}
  await collect(
    streamReplyText('问题', { provider: makeProvider(['x'], spy), apiKey: 'k', baseUrl: 'b', model: 'm' }, {
      systemPrompt: '你是代码审查员',
      model: 'bound-model',
      params: { temperature: 0.2 }
    })
  )

  assert.deepEqual(spy.request?.messages, [
    { role: 'system', content: '你是代码审查员' },
    { role: 'user', content: '问题' }
  ])
  assert.equal(spy.request?.model, 'bound-model', '助手绑定的模型应覆盖默认模型')
  assert.equal(spy.request?.params?.temperature, 0.2)
})

test('空白 systemPrompt 不插入 system 消息', async () => {
  const spy: { request?: ChatStreamRequest } = {}
  await collect(
    streamReplyText('问题', { provider: makeProvider(['x'], spy), apiKey: 'k', baseUrl: 'b', model: 'm' }, {
      systemPrompt: '   '
    })
  )
  assert.deepEqual(spy.request?.messages, [{ role: 'user', content: '问题' }])
})

test('有参考片段时拼进用户消息，并保留来源', async () => {
  const spy: { request?: ChatStreamRequest } = {}
  await collect(
    streamReplyText(
      '工作台是什么',
      { provider: makeProvider(['x'], spy), apiKey: 'k', baseUrl: 'b', model: 'm' },
      { references: '[1] 来源：notes/intro.md\nPointStudio 是 AI 工作台。' }
    )
  )

  const userMessage = spy.request?.messages.at(-1)
  assert.equal(userMessage?.role, 'user')
  assert.ok(userMessage?.content.includes('notes/intro.md'))
  assert.ok(userMessage?.content.includes('工作台是什么'), '原问题必须还在')
})

test('没有参考片段时不改动用户消息', async () => {
  const spy: { request?: ChatStreamRequest } = {}
  await collect(
    streamReplyText('问题', { provider: makeProvider(['x'], spy), apiKey: 'k', baseUrl: 'b', model: 'm' }, {
      references: '   '
    })
  )

  assert.deepEqual(spy.request?.messages.at(-1), { role: 'user', content: '问题' })
})

test('平台声明不需要 Key 时，即使没配 Key 也走真模型', async () => {
  const seen: { called: boolean } = { called: false }
  const provider: ChatProvider = {
    id: 'local',
    requiresApiKey: false,
    async *streamChat(): AsyncGenerator<string> {
      seen.called = true
      yield 'x'
    }
  }

  const base = { provider, baseUrl: 'b', model: 'm' }
  assert.equal(resolveMode({ ...base, apiKey: null }), 'live', '本地模型不该被判成本地假流式')

  await collect(streamReplyText('你好', { ...base, apiKey: null }))
  assert.equal(seen.called, true, '应当真的调用 provider')
})
