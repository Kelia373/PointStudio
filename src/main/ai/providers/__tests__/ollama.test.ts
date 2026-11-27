// 契约测试：Ollama 平台实现（NDJSON 流、错误归一、免 Key）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { OllamaProvider, parseOllamaNdjson } from '../ollama.ts'
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

test('解析 NDJSON：逐行取 message.content，done 后停止', async () => {
  const text = await collect(
    parseOllamaNdjson(
      fromChunks([
        '{"message":{"content":"你"},"done":false}\n',
        '{"message":{"content":"好"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
        '{"message":{"content":"不该出现"},"done":false}\n'
      ])
    )
  )
  assert.deepEqual(text, ['你', '好'])
})

test('一行被拆成两个 chunk 也能拼回来', async () => {
  const line = '{"message":{"content":"拼接"},"done":false}\n'
  const text = await collect(
    parseOllamaNdjson(fromChunks([line.slice(0, 10), line.slice(10), '{"done":true}\n']))
  )
  assert.deepEqual(text, ['拼接'])
})

test('多字节字符被按字节切断时不乱码', async () => {
  const line = new TextEncoder().encode('{"message":{"content":"汉字"},"done":false}\n')
  const text = await collect(
    parseOllamaNdjson(fromChunks([line.subarray(0, 9), line.subarray(9), '{"done":true}\n']))
  )
  assert.deepEqual(text, ['汉字'])
})

test('结束行没有换行符也会被处理', async () => {
  const text = await collect(parseOllamaNdjson(fromChunks(['{"message":{"content":"尾"},"done":false}'])))
  assert.deepEqual(text, ['尾'])
})

test('畸形行被跳过，不炸整条流', async () => {
  const text = await collect(
    parseOllamaNdjson(
      fromChunks(['不是 json\n', '{"message":{"content":"ok"},"done":false}\n', '{"done":true}\n'])
    )
  )
  assert.deepEqual(text, ['ok'])
})

test('Ollama 不需要 API Key（声明 requiresApiKey=false）', () => {
  const provider = new OllamaProvider()
  assert.equal(provider.id, 'ollama')
  assert.equal(provider.requiresApiKey, false)
})

test('请求打到 /api/chat 并带上 model 与 stream', async () => {
  let seenPath = ''
  let seenBody: Record<string, unknown> = {}
  const server = createServer((request, response) => {
    seenPath = request.url ?? ''
    let body = ''
    request.on('data', (piece) => {
      body += piece
    })
    request.on('end', () => {
      seenBody = JSON.parse(body) as Record<string, unknown>
      response.writeHead(200, { 'content-type': 'application/x-ndjson' })
      response.write('{"message":{"content":"hi"},"done":false}\n')
      response.end('{"done":true}\n')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  try {
    const provider = new OllamaProvider()
    const text = await collect(
      provider.streamChat({
        apiKey: '',
        baseUrl: `http://127.0.0.1:${port}`,
        model: 'qwen2.5',
        messages: [{ role: 'user', content: 'hi' }]
      })
    )

    assert.deepEqual(text, ['hi'])
    assert.equal(seenPath, '/api/chat')
    assert.equal(seenBody.model, 'qwen2.5')
    assert.equal(seenBody.stream, true)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('HTTP 报错归一为 ProviderError 且带状态码', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' })
    response.end('{"error":"boom"}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  try {
    const provider = new OllamaProvider()
    await assert.rejects(
      async () => {
        for await (const _chunk of provider.streamChat({
          apiKey: '',
          baseUrl: `http://127.0.0.1:${port}`,
          model: 'm',
          messages: []
        })) {
          // 不该有内容
        }
      },
      (error: unknown) => {
        assert.ok(error instanceof ProviderError)
        assert.equal(error.code, 'E_HTTP')
        assert.equal(error.status, 500)
        return true
      }
    )
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
