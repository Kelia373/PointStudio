// 契约测试：把一个 MCP 服务接进工具注册表。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

import { connectMcpTools } from '../mcpService.ts'
import { ToolRegistry } from '../../ai/tools/registry.ts'

async function withMcpServer(
  run: (url: string, seen: string[]) => Promise<void>
): Promise<void> {
  const seen: string[] = []
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', (piece) => {
      body += piece
    })
    request.on('end', () => {
      const message = JSON.parse(body) as { id: number; method: string }
      seen.push(message.method)
      response.writeHead(200, { 'content-type': 'application/json' })

      if (message.method === 'initialize') {
        response.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: message.id,
            result: { protocolVersion: '2024-11-05', capabilities: {} }
          })
        )
        return
      }
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
                  inputSchema: {
                    type: 'object',
                    properties: { text: { type: 'string' } },
                    required: ['text']
                  }
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
    await run(`http://127.0.0.1:${port}/mcp`, seen)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

test('连接后完成 initialize 握手并注册工具', async () => {
  await withMcpServer(async (url, seen) => {
    const registry = new ToolRegistry()
    const connection = await connectMcpTools(url, registry, { serverName: 'demo' })

    assert.deepEqual(seen.slice(0, 2), ['initialize', 'tools/list'])
    assert.deepEqual(connection.toolNames, ['mcp_demo_echo'])

    const tool = registry.get('mcp_demo_echo')
    assert.ok(tool)
    assert.equal(tool?.sideEffect, 'external', '外部工具默认最高风险')
    assert.equal(tool?.requiresApproval, true)
  })
})

test('同一服务重复连接时给工具名加序号，不报重名', async () => {
  await withMcpServer(async (url) => {
    const registry = new ToolRegistry()
    await connectMcpTools(url, registry, { serverName: 'demo' })
    const second = await connectMcpTools(url, registry, { serverName: 'demo' })

    assert.deepEqual(second.toolNames, ['mcp_demo_echo_2'])
  })
})

test('dispose 后释放客户端（不再处理后续消息）', async () => {
  await withMcpServer(async (url) => {
    const registry = new ToolRegistry()
    const connection = await connectMcpTools(url, registry, { serverName: 'demo' })
    connection.dispose()
    assert.ok(true)
  })
})

test('服务不可达时抛出，且不留下半个工具', async () => {
  const registry = new ToolRegistry()
  await assert.rejects(() => connectMcpTools('http://127.0.0.1:1/mcp', registry, { serverName: 'x' }))
  assert.deepEqual(registry.list(), [])
})
