// 契约测试：DeepSeek 模型接入（SSE 流式解析 + 错误归一）。
// 不连外网：用本地 http 服务模拟平台，用内存 chunk 模拟 SSE 字节流。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { DeepSeekProvider, parseOpenAiSseStream } from '../deepseek.ts'
import { OpenAiCompatibleProvider } from '../openaiCompatible.ts'
import { ProviderError } from '../types.ts'

async function* fromChunks(chunks: Array<string | Uint8Array>): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    yield typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
  }
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const item of stream) {
    out.push(item)
  }
  return out
}

test('按 SSE 解析出增量文本', async () => {
  const text = await collect(
    parseOpenAiSseStream(
      fromChunks([
        'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
        'data: [DONE]\n\n'
      ])
    )
  )
  assert.deepEqual(text, ['你', '好'])
})

test('收到 [DONE] 后不再产出', async () => {
  const text = await collect(
    parseOpenAiSseStream(
      fromChunks([
        'data: {"choices":[{"delta":{"content":"A"}}]}\n',
        'data: [DONE]\n',
        'data: {"choices":[{"delta":{"content":"不该出现"}}]}\n'
      ])
    )
  )
  assert.deepEqual(text, ['A'])
})

test('一行 JSON 被拆到两个 chunk 也能拼回来', async () => {
  const json = 'data: {"choices":[{"delta":{"content":"拼接成功"}}]}\n'
  const text = await collect(
    parseOpenAiSseStream(fromChunks([json.slice(0, 12), json.slice(12), 'data: [DONE]\n']))
  )
  assert.deepEqual(text, ['拼接成功'])
})

test('多字节字符被按字节切断时不产生乱码', async () => {
  const line = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"汉字"}}]}\n')
  // 在第 8 个字节处硬切，几乎必然切在一个 UTF-8 字符中间。
  const text = await collect(
    parseOpenAiSseStream(fromChunks([line.subarray(0, 8), line.subarray(8), 'data: [DONE]\n']))
  )
  assert.deepEqual(text, ['汉字'])
})

test('空 delta 与非 data 行被忽略', async () => {
  const text = await collect(
    parseOpenAiSseStream(
      fromChunks([
        ': keep-alive\n',
        'event: message\n',
        'data: {"choices":[{"delta":{}}]}\n',
        'data: {"choices":[{"delta":{"content":"X"},"finish_reason":"stop"}]}\n',
        'data: [DONE]\n'
      ])
    )
  )
  assert.deepEqual(text, ['X'])
})

test('未收尾的半行在流结束时也要被解析', async () => {
  const text = await collect(
    parseOpenAiSseStream(fromChunks(['data: {"choices":[{"delta":{"content":"尾巴"}}]}']))
  )
  assert.deepEqual(text, ['尾巴'])
})

test('HTTP 非 2xx 归一为 ProviderError（带状态码）', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(401, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  try {
    const provider = new DeepSeekProvider()
    const stream = provider.streamChat({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: 'hi' }]
    })
    await assert.rejects(
      async () => {
        for await (const _chunk of stream) {
          // 不该有内容
        }
      },
      (error: unknown) => {
        assert.ok(error instanceof ProviderError)
        assert.equal(error.code, 'E_HTTP')
        assert.equal(error.status, 401)
        return true
      }
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('缺少 apiKey 直接拒绝，不发请求', async () => {
  const provider = new DeepSeekProvider()
  await assert.rejects(
    async () => {
      for await (const _chunk of provider.streamChat({
        apiKey: '',
        baseUrl: 'http://127.0.0.1:1',
        model: 'deepseek-chat',
        messages: []
      })) {
        // 不该有内容
      }
    },
    (error: unknown) => {
      assert.ok(error instanceof ProviderError)
      assert.equal(error.code, 'E_MISSING_KEY')
      return true
    }
  )
})

test('OpenAI 兼容线：reasoning_effort 只对支持调档的模型发出', async () => {
  const bodies: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      bodies.push(body)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const provider = new OpenAiCompatibleProvider({
      id: 'openai',
      defaultBaseUrl: `http://127.0.0.1:${port}`,
      defaultModel: 'o3'
    })
    for await (const _chunk of provider.streamChat({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'o3',
      supportedEfforts: ['low', 'mid', 'high'],
      messages: [{ role: 'user', content: 'hi' }],
      params: { effort: 'mid' }
    })) {
      // 消费
    }
    for await (const _chunk of provider.streamChat({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'deepseek-chat',
      supportedEfforts: [],
      messages: [{ role: 'user', content: 'hi' }],
      params: { effort: 'high' }
    })) {
      // 消费
    }
    const first = JSON.parse(bodies[0]) as Record<string, unknown>
    assert.equal(first.reasoning_effort, 'medium')
    const second = JSON.parse(bodies[1]) as Record<string, unknown>
    assert.equal('reasoning_effort' in second, false, '普通模型不该带 reasoning_effort')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('P2-B：OpenAI 兼容线把 xhigh/max 夹到 high，不发上游不认识的值', async () => {
  const bodies: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      bodies.push(body)
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    const provider = new OpenAiCompatibleProvider({
      id: 'openrouter',
      defaultBaseUrl: `http://127.0.0.1:${port}`,
      defaultModel: 'claude-sonnet-4.5'
    })
    for await (const _chunk of provider.streamChat({
      apiKey: 'test-key',
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'claude-sonnet-4.5',
      supportedEfforts: ['low', 'mid', 'high', 'xhigh', 'max'],
      messages: [{ role: 'user', content: 'hi' }],
      params: { effort: 'max' }
    })) {
      // 消费
    }
    const body = JSON.parse(bodies[0]) as Record<string, unknown>
    assert.equal(body.reasoning_effort, 'high')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
