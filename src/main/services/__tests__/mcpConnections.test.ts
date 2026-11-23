// 契约测试：MCP 服务的接入与断开（工具随之增删，不留残骸）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { McpConnections } from '../mcpConnections.ts'
import { ToolRegistry } from '../../ai/tools/registry.ts'

async function withServer(run: (url: string) => Promise<void>): Promise<void> {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (piece) => {
      body += piece
    })
    request.on('end', () => {
      const message = JSON.parse(body) as { id: number; method: string }
      response.writeHead(200, { 'content-type': 'application/json' })
      if (message.method === 'tools/list') {
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: [
                {
                  name: 'echo',
                  description: '回显',
                  inputSchema: { type: 'object', properties: { text: { type: 'string' } } }
                }
              ]
            }
          })
        )
        return
      }
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: {} }))
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

test('接入后工具出现在注册表，断开后消失', async () => {
  await withServer(async (url) => {
    const registry = new ToolRegistry()
    const connections = new McpConnections(registry)

    const added = await connections.add({ url, serverName: 'demo' })
    assert.equal(added.ok, true)
    assert.ok(registry.get('mcp_demo_echo'))

    const removed = connections.remove('demo')
    assert.equal(removed.ok, true)
    assert.equal(registry.get('mcp_demo_echo'), undefined, '断开后不该留下工具')
  })
})

test('重复接入同一服务名被拒绝，不产生两份连接', async () => {
  await withServer(async (url) => {
    const connections = new McpConnections(new ToolRegistry())
    await connections.add({ url, serverName: 'demo' })
    const again = await connections.add({ url, serverName: 'demo' })

    assert.equal(again.ok, false)
    if (!again.ok) {
      assert.ok(again.errors.includes('E_MCP_ALREADY_CONNECTED'))
    }
    assert.equal(connections.list().length, 1)
  })
})

test('断开不存在的服务返回 E_NOT_FOUND', async () => {
  const connections = new McpConnections(new ToolRegistry())
  const result = connections.remove('missing')
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_NOT_FOUND'))
  }
})

test('列出已接入的服务名', async () => {
  await withServer(async (url) => {
    const connections = new McpConnections(new ToolRegistry())
    await connections.add({ url, serverName: 'demo' })
    assert.deepEqual(connections.list(), ['demo'])
  })
})
