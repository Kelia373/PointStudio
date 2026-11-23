// ipc/mcp —— 外部 MCP 服务的接入与断开。
//
// 只暴露最小面：列出、接入、断开。工具注册/注销由 McpConnections 负责，
// 这里只做参数校验与错误归一（外部地址不可信，协议体也不可信）。
import { ipcMain } from 'electron'

import {
  MCP_CHANNELS,
  type IpcResult,
  type McpConnectionDto
} from '../../shared/types/ipc.ts'
import type { McpConnections } from '../services/mcpConnections.ts'

const SERVER_NAME_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/

export interface McpIpcOptions {
  connections: McpConnections
}

export function registerMcpIpc(options: McpIpcOptions): void {
  ipcMain.handle(MCP_CHANNELS.list, async (): Promise<McpConnectionDto[]> => {
    // 仅返回名字与地址；工具列表可由 agent 的能力清单拿到。
    return options.connections.list().map((serverName) => ({ serverName, url: '' }))
  })

  ipcMain.handle(
    MCP_CHANNELS.add,
    async (_event, request: unknown): Promise<IpcResult<{ toolNames: string[] }>> => {
      if (typeof request !== 'object' || request === null) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const { serverName, url } = request as { serverName?: unknown; url?: unknown }
      if (typeof serverName !== 'string' || !SERVER_NAME_PATTERN.test(serverName)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
        return { ok: false, code: 'E_BASE_URL_INVALID' }
      }

      const result = await options.connections.add({ url, serverName })
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    MCP_CHANNELS.remove,
    async (_event, serverName: unknown): Promise<IpcResult<true>> => {
      if (typeof serverName !== 'string') {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = options.connections.remove(serverName)
      return result.ok ? { ok: true, value: true } : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )
}
