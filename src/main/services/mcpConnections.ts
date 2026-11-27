// services/mcpConnections —— MCP 服务的接入与断开登记。
//
// 只做一件事：让「接入」与「断开」对称。断开时必须把工具从注册表删掉，
// 否则用户看到的是一张仍在、但已经连不上的工具列表——点了只会报错。
import type { ToolRegistry } from '../ai/tools/registry.ts'
import { connectMcpTools } from './mcpService.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface McpConnectionInput {
  url: string
  serverName: string
  headers?: Record<string, string>
  timeoutMs?: number
}

interface Connection {
  serverName: string
  url: string
  toolNames: string[]
  dispose: () => void
}

export class McpConnections {
  private readonly registry: ToolRegistry
  private readonly connections = new Map<string, Connection>()

  constructor(registry: ToolRegistry) {
    this.registry = registry
  }

  async add(input: McpConnectionInput): Promise<ServiceResult<{ toolNames: string[] }>> {
    if (this.connections.has(input.serverName)) {
      return { ok: false, errors: ['E_MCP_ALREADY_CONNECTED'] }
    }

    const connection = await connectMcpTools(input.url, this.registry, {
      serverName: input.serverName,
      headers: input.headers,
      timeoutMs: input.timeoutMs
    })

    this.connections.set(input.serverName, {
      serverName: input.serverName,
      url: input.url,
      toolNames: connection.toolNames,
      dispose: connection.dispose
    })
    return { ok: true, value: { toolNames: connection.toolNames } }
  }

  /** 断开：先摘工具，再释放客户端。顺序反了会让界面短暂看到"工具在但连不上"。 */
  remove(serverName: string): ServiceResult<true> {
    const connection = this.connections.get(serverName)
    if (!connection) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    for (const toolName of connection.toolNames) {
      this.registry.unregister(toolName)
    }
    connection.dispose()
    this.connections.delete(serverName)
    return { ok: true, value: true }
  }

  list(): string[] {
    return [...this.connections.keys()].sort()
  }

  /** 断开全部（退出应用时调用，避免把连接留到进程结束）。 */
  removeAll(): void {
    for (const name of [...this.connections.keys()]) {
      this.remove(name)
    }
  }
}
