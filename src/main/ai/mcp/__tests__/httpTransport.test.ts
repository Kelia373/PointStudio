// 契约测试：MCP HTTP 传输（JSON 响应、SSE 响应、HTTP 错误）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { McpHttpTransport } from '../httpTransport.ts'

async function withServer(
  handler: (request: { url?: string; headers: Record<string, unknown>; body: string }, response: import('node:http').ServerResponse) => void,
  run: (url: string) => Promise<void>
): Promise<void> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (piece) => {
      body += piece
    })
    request.on('end', () => {
      handler({ url: request.url, headers: request.headers as Record<string, unknown>, body }, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  try {
    await run(`http://127.0.0.1:${port}/mcp`)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('收到 JSON 响应时投递给订阅者', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'ok' }))
    },
    async (url) => {
      const received: unknown[] = []
      const transport = new McpHttpTransport(url)
      const off = transport.onMessage((message) => received.push(message))

      await transport.send({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
      off()

      assert.deepEqual(received, [{ jsonrpc: '2.0', id: 1, result: 'ok' }])
    }
  )
})

test('收到 SSE 响应时逐条投递', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.write('data: {"jsonrpc":"2.0","id":1,"result":"a"}\n\n')
      response.end('data: {"jsonrpc":"2.0","id":2,"result":"b"}\n\n')
    },
    async (url) => {
      const received: Array<{ id?: number }> = []
      const transport = new McpHttpTransport(url)
      transport.onMessage((message) => received.push(message as { id?: number }))

      await transport.send({ jsonrpc: '2.0', id: 1, method: 'x', params: {} })

      assert.deepEqual(
        received.map((item) => item.id),
        [1, 2]
      )
    }
  )
})

test('请求带 JSON 头与 accept 两种格式', async () => {
  let headers: Record<string, unknown> = {}
  let body = ''
  await withServer(
    (request, response) => {
      headers = request.headers
      body = request.body
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"jsonrpc":"2.0","id":1,"result":null}')
    },
    async (url) => {
      const transport = new McpHttpTransport(url)
      transport.onMessage(() => undefined)
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'x', params: {} })
    }
  )

  assert.equal(String(headers['content-type']).includes('application/json'), true)
  assert.equal(String(headers.accept).includes('text/event-stream'), true)
  assert.ok(body.includes('"method":"x"'))
})

test('HTTP 非 2xx 时抛出带状态码的错误', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(503)
      response.end('down')
    },
    async (url) => {
      const transport = new McpHttpTransport(url)
      transport.onMessage(() => undefined)
      await assert.rejects(
        () => transport.send({ jsonrpc: '2.0', id: 1, method: 'x', params: {} }),
        (error: unknown) => {
          assert.equal((error as { status?: number }).status, 503)
          return true
        }
      )
    }
  )
})

test('响应体为空时不投递任何消息', async () => {
  await withServer(
    (_request, response) => {
      response.writeHead(202)
      response.end('')
    },
    async (url) => {
      const received: unknown[] = []
      const transport = new McpHttpTransport(url)
      transport.onMessage((message) => received.push(message))
      await transport.send({ jsonrpc: '2.0', id: 1, method: 'x', params: {} })
      assert.deepEqual(received, [])
    }
  )
})
