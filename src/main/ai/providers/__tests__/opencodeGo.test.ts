// 契约测试：OpenCode Go 网关（必填请求头、双线路、协议自动切换）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import {
  OpencodeGoProvider,
  opencodeChatUrl,
  opencodeModelsUrl,
  opencodeUsageUrl,
  parseAnthropicSseStream,
  resolveOpencodeEndpoints
} from '../opencodeGo.ts'
import { ProviderError, type TokenUsageSample } from '../types.ts'

async function* fromChunks(chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    yield new TextEncoder().encode(chunk)
  }
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let out = ''
  for await (const item of stream) {
    out += item
  }
  return out
}

interface Captured {
  url: string
  headers: IncomingMessage['headers']
  body: string
}

async function withServer(
  handler: (request: Captured, response: ServerResponse) => void,
  run: (baseUrl: string, requests: Captured[]) => Promise<void>
): Promise<void> {
  const requests: Captured[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => {
      body += chunk
    })
    request.on('end', () => {
      const captured = { url: request.url ?? '', headers: request.headers, body }
      requests.push(captured)
      handler(captured, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  try {
    await run(`http://127.0.0.1:${port}/inference/go/openai/v1`, requests)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('端点推导：openai / zen 前缀与 anthropic 线路', () => {
  assert.deepEqual(resolveOpencodeEndpoints('https://opencode.ai/inference/go/openai/v1'), {
    origin: 'https://opencode.ai',
    prefix: '/inference/go'
  })
  assert.deepEqual(resolveOpencodeEndpoints('https://opencode.ai/zen/go/openai/v1'), {
    origin: 'https://opencode.ai',
    prefix: '/zen/go'
  })
  assert.equal(
    opencodeChatUrl('https://opencode.ai/inference/go/anthropic/v1', 'anthropic'),
    'https://opencode.ai/inference/go/anthropic/v1/messages'
  )
  assert.equal(
    opencodeModelsUrl('https://opencode.ai/zen/go/openai/v1'),
    'https://opencode.ai/zen/go/v1/models'
  )
  assert.equal(
    opencodeUsageUrl('https://opencode.ai/inference/go/openai/v1'),
    'https://opencode.ai/inference/go/v1/usage'
  )
})

test('OpenAI 线：必带 x-opencode-session / User-Agent，尾帧 usage 被捕获', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"你"}}]}\n\n')
      response.write('data: {"choices":[{"delta":{"content":"好"}}]}\n\n')
      response.write(
        'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":5,"total_tokens":16,"prompt_cache_hit_tokens":3}}\n\n'
      )
      response.write('data: [DONE]\n\n')
      response.end()
    },
    async (baseUrl, requests) => {
      const samples: TokenUsageSample[] = []
      const provider = new OpencodeGoProvider()
      const text = await collect(
        provider.streamChat({
          apiKey: 'oc_sk_test',
          baseUrl,
          model: 'kimi-k2.5',
          messages: [{ role: 'user', content: 'hi' }],
          sessionId: 'conv-123',
          onUsage: (usage) => samples.push(usage)
        })
      )
      assert.equal(text, '你好')
      assert.equal(requests[0].url, '/inference/go/openai/v1/chat/completions')
      assert.equal(requests[0].headers['x-opencode-session'], 'conv-123')
      assert.equal(requests[0].headers['user-agent'], 'PointStudio/0.1')
      assert.equal(requests[0].headers['authorization'], 'Bearer oc_sk_test')
      assert.match(requests[0].body, /"include_usage":true/)
      assert.deepEqual(samples, [
        { promptTokens: 11, completionTokens: 5, totalTokens: 16, cacheHitTokens: 3 }
      ])
    }
  )
})

test('Claude 系模型走 Anthropic 线，解析 text_delta 与分散的 usage', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('event: message_start\n')
      response.write(
        'data: {"type":"message_start","message":{"usage":{"input_tokens":9,"cache_read_input_tokens":2}}}\n\n'
      )
      response.write('event: content_block_delta\n')
      response.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"答"}}\n\n')
      response.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"案"}}\n\n')
      response.write('data: {"type":"message_delta","usage":{"output_tokens":7}}\n\n')
      response.write('data: {"type":"message_stop"}\n\n')
      response.end()
    },
    async (baseUrl, requests) => {
      const samples: TokenUsageSample[] = []
      const provider = new OpencodeGoProvider()
      const text = await collect(
        provider.streamChat({
          apiKey: 'oc_sk_test',
          baseUrl,
          model: 'claude-sonnet-4-5',
          messages: [
            { role: 'system', content: '你是助手' },
            { role: 'user', content: 'hi' }
          ],
          sessionId: 'conv-9',
          onUsage: (usage) => samples.push(usage)
        })
      )
      assert.equal(text, '答案')
      assert.equal(requests[0].url, '/inference/go/anthropic/v1/messages')
      assert.equal(requests[0].headers['anthropic-version'], '2023-06-01')
      assert.equal(requests[0].headers['x-opencode-session'], 'conv-9')
      assert.match(requests[0].body, /"system":"你是助手"/)
      assert.deepEqual(samples, [
        { promptTokens: 9, completionTokens: 7, totalTokens: 16, cacheHitTokens: 2 }
      ])
    }
  )
})

test('400 ModelProtocolUnsupported 时自动切另一条线路重试一次', async () => {
  await withServer(
    (request, response) => {
      if (request.url.includes('/anthropic/')) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"切换成功"}}\n\n')
        response.write('data: {"type":"message_stop"}\n\n')
        response.end()
        return
      }
      response.writeHead(400, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { code: 'ModelProtocolUnsupported' } }))
    },
    async (baseUrl, requests) => {
      const provider = new OpencodeGoProvider()
      const text = await collect(
        provider.streamChat({
          apiKey: 'oc_sk_test',
          baseUrl,
          // 非 claude 名先走 OpenAI 线，被平台拒绝后应自动切 Anthropic 线
          model: 'deepseek-v3',
          messages: [{ role: 'user', content: 'hi' }]
        })
      )
      assert.equal(text, '切换成功')
      assert.equal(requests.length, 2)
      assert.equal(requests[0].url, '/inference/go/openai/v1/chat/completions')
      assert.equal(requests[1].url, '/inference/go/anthropic/v1/messages')
    }
  )
})

test('缺 Key 直接拒绝，不发请求', async () => {
  const provider = new OpencodeGoProvider()
  await assert.rejects(
    async () => {
      for await (const _chunk of provider.streamChat({
        apiKey: '',
        baseUrl: 'http://127.0.0.1:1',
        model: 'kimi-k2.5',
        messages: []
      })) {
        // 不该有内容
      }
    },
    (error: unknown) => error instanceof ProviderError && error.code === 'E_MISSING_KEY'
  )
})

test('Anthropic SSE：非 text_delta 事件被忽略，空行与脏行不炸流', async () => {
  const text = await collect(
    parseAnthropicSseStream(
      fromChunks([
        'data: {"type":"ping"}\n\n',
        'data: not-json\n\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"A"}}\n\n',
        'data: {"type":"message_stop"}\n'
      ])
    )
  )
  assert.equal(text, 'A')
})

test('Anthropic 线：thinking budget 与首条 assistant 裁剪', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}\n\n')
      response.write('data: {"type":"message_stop"}\n\n')
      response.end()
    },
    async (baseUrl, requests) => {
      const provider = new OpencodeGoProvider()
      for await (const _chunk of provider.streamChat({
        apiKey: 'oc_sk_test',
        baseUrl,
        model: 'claude-sonnet-4-5',
        supportedEfforts: ['low', 'mid', 'high', 'xhigh', 'max'],
        messages: [
          { role: 'assistant', content: '上一轮的回复' },
          { role: 'user', content: '继续' }
        ],
        params: { effort: 'high', maxTokens: 2048 }
      })) {
        // 消费
      }
      const body = JSON.parse(requests[0].body) as {
        thinking?: { type: string; budget_tokens: number }
        max_tokens: number
        messages: Array<{ role: string; content: string }>
      }
      assert.deepEqual(body.thinking, { type: 'enabled', budget_tokens: 4096 })
      assert.ok(body.max_tokens > 4096, 'max_tokens 必须大于 budget')
      assert.equal(body.messages[0].role, 'user', '开头 assistant 必须被裁掉')
      assert.equal(body.messages.length, 1)
    }
  )
})

test('OpenCode Go 的 OpenAI 线同样夹紧 xhigh/max（与通用兼容线共用一张表）', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n')
      response.write('data: [DONE]\n\n')
      response.end()
    },
    async (baseUrl, requests) => {
      const provider = new OpencodeGoProvider()
      for await (const _chunk of provider.streamChat({
        apiKey: 'oc_sk_test',
        baseUrl,
        model: 'gpt-5.2-codex',
        supportedEfforts: ['low', 'mid', 'high', 'xhigh'],
        messages: [{ role: 'user', content: 'hi' }],
        params: { effort: 'xhigh' }
      })) {
        // 消费
      }
      const body = JSON.parse(requests[0].body) as Record<string, unknown>
      assert.equal(body.reasoning_effort, 'high')
    }
  )
})

test('Anthropic thinking_delta 分流到 onReasoning，text_delta 仍是正文', async () => {
  const reasoning: string[] = []
  let text = ''
  for await (const chunk of parseAnthropicSseStream(
    fromChunks([
      'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"想"}}\n\n',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"答"}}\n\n',
      'data: {"type":"message_stop"}\n\n'
    ]),
    undefined,
    (delta) => reasoning.push(delta)
  )) {
    text += chunk
  }
  assert.deepEqual(reasoning, ['想'])
  assert.equal(text, '答')
})
