// 契约测试：MCP 客户端内核（JSON-RPC 关联、错误、超时、工具映射）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { McpClient, mapInputSchemaToParams, toToolDefinition, type McpTransport } from '../client.ts'

interface SentMessage {
  jsonrpc: string
  id?: number
  method?: string
  params?: unknown
  result?: unknown
  error?: { code: number; message: string }
}

function makeTransport(): {
  transport: McpTransport
  sent: SentMessage[]
  reply: (message: SentMessage) => void
} {
  const sent: SentMessage[] = []
  const handlers = new Set<(message: unknown) => void>()
  const transport: McpTransport = {
    send: async (message) => {
      sent.push(message as SentMessage)
    },
    onMessage: (handler) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    }
  }
  return {
    transport,
    sent,
    reply: (message) => {
      for (const handler of handlers) {
        handler(message)
      }
    }
  }
}

test('请求形状符合 JSON-RPC 2.0，id 递增', async () => {
  const { transport, sent, reply } = makeTransport()
  const client = new McpClient(transport)

  const pending = client.request('tools/list', {})
  await Promise.resolve()
  assert.equal(sent[0].jsonrpc, '2.0')
  assert.equal(sent[0].method, 'tools/list')
  assert.equal(typeof sent[0].id, 'number')

  reply({ jsonrpc: '2.0', id: sent[0].id, result: { tools: [] } })
  await pending
})

test('响应按 id 关联，不串号', async () => {
  const { transport, sent, reply } = makeTransport()
  const client = new McpClient(transport)

  const first = client.request('a', {})
  const second = client.request('b', {})
  await Promise.resolve()

  // 故意乱序回复
  reply({ jsonrpc: '2.0', id: sent[1].id, result: 'B' })
  reply({ jsonrpc: '2.0', id: sent[0].id, result: 'A' })

  assert.equal(await first, 'A')
  assert.equal(await second, 'B')
})

test('错误响应 reject 并带上 code', async () => {
  const { transport, sent, reply } = makeTransport()
  const client = new McpClient(transport)

  const pending = client.request('boom', {})
  await Promise.resolve()
  reply({ jsonrpc: '2.0', id: sent[0].id, error: { code: -32601, message: 'method not found' } })

  await assert.rejects(
    () => pending,
    (error: unknown) => {
      assert.equal((error as { code?: number }).code, -32601)
      return true
    }
  )
})

test('超时后 reject，迟到的响应被忽略', async () => {
  const { transport, sent, reply } = makeTransport()
  const client = new McpClient(transport, { timeoutMs: 20 })

  await assert.rejects(() => client.request('slow', {}))

  // 迟到响应不应引发未处理的异常或二次 resolve
  reply({ jsonrpc: '2.0', id: sent[0].id, result: 'late' })
  assert.ok(true)
})

test('listTools 把 inputSchema 映射成 ToolParams', async () => {
  const { transport, reply } = makeTransport()
  const client = new McpClient(transport)

  const pending = client.listTools()
  await Promise.resolve()
  reply({
    jsonrpc: '2.0',
    id: 1,
    result: {
      tools: [
        {
          name: 'echo',
          description: '回显',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: '要回显的内容' },
              times: { type: 'number' }
            },
            required: ['text']
          }
        }
      ]
    }
  })

  const tools = await pending
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'echo')
  assert.equal(tools[0].params.text.type, 'string')
  assert.equal(tools[0].params.text.required, true)
  assert.equal(tools[0].params.times.required, undefined)
})

test('不支持的 JSON Schema 类型被跳过而不是猜', () => {
  const params = mapInputSchemaToParams({
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      weird: { type: 'bogus' },
      nested: { type: 'object' }
    },
    required: ['weird']
  })
  assert.deepEqual(Object.keys(params), ['ok'])
})

test('没有 inputSchema 时参数表为空', () => {
  assert.deepEqual(mapInputSchemaToParams(undefined), {})
})

test('toToolDefinition 真的发起 tools/call 并拼出文本结果', async () => {
  const { transport, sent, reply } = makeTransport()
  const client = new McpClient(transport)

  const pending = client.listTools()
  await Promise.resolve()
  reply({
    jsonrpc: '2.0',
    id: 1,
    result: { tools: [{ name: 'echo', description: '回显', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] }
  })
  const [descriptor] = await pending
  const tool = toToolDefinition(client, descriptor)

  const call = tool.handler({ text: 'hi' }, {})
  await Promise.resolve()
  const sentCall = sent.find((message) => message.method === 'tools/call')
  assert.ok(sentCall, '应发出 tools/call')
  assert.deepEqual(sentCall?.params, { name: 'echo', arguments: { text: 'hi' } })

  reply({
    jsonrpc: '2.0',
    id: sentCall?.id,
    result: { content: [{ type: 'text', text: '回声' }] }
  })
  const result = await call
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal((result.value as { text: string }).text, '回声')
  }
})

test('MCP 报错时工具返回错误码而不是抛异常', async () => {
  const { transport, sent, reply } = makeTransport()
  const client = new McpClient(transport)
  const tool = toToolDefinition(client, {
    name: 'boom',
    description: 'boom',
    sideEffect: 'external',
    requiresApproval: true,
    params: {}
  })

  const call = tool.handler({}, {})
  await Promise.resolve()
  const sentCall = sent.find((message) => message.method === 'tools/call')
  reply({ jsonrpc: '2.0', id: sentCall?.id, error: { code: -32000, message: 'x' } })

  assert.deepEqual(await call, { ok: false, code: 'E_TOOL_FAILED' })
})

test('发送失败时立刻收敛请求，不在 dispose 时冒出未处理拒绝', async () => {
  // 回归：send 抛错时旧实现把 promise 留在 pending 里没人 await，
  // dispose() 再去 reject 它就变成 unhandledRejection。
  const unhandled: unknown[] = []
  const collect = (reason: unknown): void => {
    unhandled.push(reason)
  }

  const transport: McpTransport = {
    send: async () => {
      throw new Error('ECONNREFUSED')
    },
    onMessage: () => () => {}
  }
  const client = new McpClient(transport)

  process.on('unhandledRejection', collect)
  try {
    await assert.rejects(() => client.request('tools/list', {}), /ECONNREFUSED/)
    // 失败后 dispose 不应再有任何托管中的请求可被拒绝。
    client.dispose()
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.deepEqual(unhandled, [])
  } finally {
    process.off('unhandledRejection', collect)
  }
})
