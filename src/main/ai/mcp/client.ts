// ai/mcp/client —— MCP 客户端内核（JSON-RPC 关联 + 工具映射）。
//
// 只做协议层：把「发请求 / 收响应 / 按 id 关联 / 超时 / 错误」做对，
// 传输层（stdio 子进程、streamable-http）由外壳注入 `McpTransport`。
// 这样协议逻辑可以脱离进程与网络单测——本机工作区禁止 spawn 子进程，
// stdio 传输在这里根本跑不起来。
//
// 工具映射只认 JSON Schema 里能安全表达的三类基础类型；遇到 object / array /
// enum 一律跳过，而不是猜一个最近似的类型——猜错会让工具调用参数静默变形。
import type { ToolDefinition, ToolParams } from '../tools/types.ts'

declare const process: { nextTick: (callback: () => void) => void } | undefined

export interface McpTransport {
  send: (message: unknown) => Promise<void>
  /** 返回解绑函数。 */
  onMessage: (handler: (message: unknown) => void) => () => void
}

export interface McpClientOptions {
  timeoutMs?: number
}

interface JsonRpcResponse {
  id?: number
  result?: unknown
  error?: { code: number; message: string }
}

interface JsonSchemaProperty {
  type?: string
  description?: string
}

interface McpToolPayload {
  name: string
  description?: string
  inputSchema?: {
    type?: string
    properties?: Record<string, JsonSchemaProperty>
    required?: string[]
  }
}

/** MCP 工具的描述：只有元信息，不含执行逻辑。 */
export interface McpToolDescriptor {
  name: string
  description: string
  /** MCP 工具默认视为外部副作用：宁可多问一次人，也不要静默外发。 */
  sideEffect: 'external'
  requiresApproval: true
  params: ToolParams
}

export class McpError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'McpError'
    this.code = code
  }
}

const DEFAULT_TIMEOUT_MS = 15_000

/** JSON Schema → 工具参数表。只接受 string / number / boolean。 */
export function mapInputSchemaToParams(schema: McpToolPayload['inputSchema']): ToolParams {
  const params: ToolParams = {}
  if (!schema?.properties) {
    return params
  }
  const required = new Set(schema.required ?? [])

  for (const [name, property] of Object.entries(schema.properties)) {
    const type = property.type
    if (type !== 'string' && type !== 'number' && type !== 'boolean') {
      continue
    }
    params[name] = {
      type,
      ...(required.has(name) ? { required: true } : {}),
      ...(property.description ? { description: property.description } : {})
    }
  }
  return params
}

export class McpClient {
  private readonly transport: McpTransport
  private readonly timeoutMs: number
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()
  private readonly unsubscribe: () => void

  constructor(transport: McpTransport, options: McpClientOptions = {}) {
    this.transport = transport
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.unsubscribe = transport.onMessage((message) => this.handleMessage(message))
  }

  dispose(): void {
    this.unsubscribe()
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.reject(new Error('E_MCP_DISPOSED'))
    }
    this.pending.clear()
  }

  async request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1

    const promise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new McpError(-32000, 'E_MCP_TIMEOUT'))
      }, this.timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
    })

    await this.transport.send({ jsonrpc: '2.0', id, method, params })
    return promise
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    const result = (await this.request('tools/list', {})) as { tools?: McpToolPayload[] }
    const tools = result?.tools ?? []
    return tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      sideEffect: 'external' as const,
      requiresApproval: true as const,
      params: mapInputSchemaToParams(tool.inputSchema)
    }))
  }

  async callTool(name: string, args: unknown): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args })
  }

  private handleMessage(message: unknown): void {
    const response = message as JsonRpcResponse
    if (typeof response?.id !== 'number') {
      return
    }
    const entry = this.pending.get(response.id)
    if (!entry) {
      // 迟到或未知 id：忽略，绝不让它影响其他在途请求。
      return
    }
    this.pending.delete(response.id)
    clearTimeout(entry.timer)

    if (response.error) {
      entry.reject(new McpError(response.error.code, response.error.message))
      return
    }
    entry.resolve(response.result)
  }
}

/** 把描述符接成可注册进 ToolRegistry 的定义。 */
export function toToolDefinition(client: McpClient, descriptor: McpToolDescriptor): ToolDefinition {
  return {
    name: descriptor.name,
    description: descriptor.description,
    sideEffect: descriptor.sideEffect,
    requiresApproval: descriptor.requiresApproval,
    params: descriptor.params,
    async handler(input) {
      try {
        const raw = await client.callTool(descriptor.name, input)
        const content = (raw as { content?: Array<{ type?: string; text?: string }> })?.content ?? []
        const text = content
          .filter((item) => item.type === 'text' && typeof item.text === 'string')
          .map((item) => item.text)
          .join('\n')
        return { ok: true, value: { text, raw } }
      } catch {
        // 不把 MCP 侧错误细节透给计划层：调用方只拿错误码。
        return { ok: false, code: 'E_TOOL_FAILED' }
      }
    }
  }
}
