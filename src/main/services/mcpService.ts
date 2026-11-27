// services/mcpService —— 把一个 MCP 服务接进工具注册表。
//
// 流程：建立 HTTP 传输 → initialize 握手 → tools/list → 包装成 ToolDefinition
// → 注册进 ToolRegistry。
//
// 命名规则 `mcp_<serverName>_<tool>`：避免与内置工具重名，也让人一眼看出
// "这是外部来的东西"。重名时追加序号而不是覆盖别人。
import { McpClient, toToolDefinition, type McpTransport } from '../ai/mcp/client.ts'
import { McpHttpTransport } from '../ai/mcp/httpTransport.ts'
import type { ToolRegistry } from '../ai/tools/registry.ts'

export interface ConnectMcpOptions {
  serverName: string
  headers?: Record<string, string>
  timeoutMs?: number
}

export interface McpConnection {
  toolNames: string[]
  dispose: () => void
}

function safeSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
}

/** 生成不冲突的工具名：`mcp_<server>_<tool>`，冲突时追加序号。 */
function uniqueName(registry: ToolRegistry, serverName: string, toolName: string): string {
  const base = `mcp_${safeSegment(serverName)}_${safeSegment(toolName)}`
  if (!registry.get(base)) {
    return base
  }
  let index = 2
  while (registry.get(`${base}_${index}`)) {
    index += 1
  }
  return `${base}_${index}`
}

export async function connectMcpTools(
  url: string,
  registry: ToolRegistry,
  options: ConnectMcpOptions
): Promise<McpConnection> {
  const transport: McpTransport = new McpHttpTransport(url, {
    headers: options.headers,
    timeoutMs: options.timeoutMs
  })
  const client = new McpClient(transport, { timeoutMs: options.timeoutMs })

  try {
    // 握手：部分服务不握手就拒绝后续调用。
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      clientInfo: { name: 'PointStudio', version: '0.0.0' },
      capabilities: {}
    })

    const descriptors = await client.listTools()
    const toolNames: string[] = []

    for (const descriptor of descriptors) {
      const name = uniqueName(registry, options.serverName, descriptor.name)
      registry.register(toToolDefinition(client, { ...descriptor, name }))
      toolNames.push(name)
    }

    return { toolNames, dispose: () => client.dispose() }
  } catch (error) {
    // 连接失败不能留下半个客户端（监听器会泄漏）。
    client.dispose()
    throw error
  }
}
