// ai/tools/types —— 工具协议的类型定义。
//
// 一个工具必须自己说清三件事：接受什么参数、会产生什么副作用、允不允许超时。
// 副作用等级不是注释，是运行时数据——规划阶段要靠它决定「这一步要不要先问人」。
// 本文件禁止 import electron / react，也不做权限判断（权限属于策略层）。

/** 副作用等级从轻到重。`costly`（花钱）与 `external`（对外发送）默认需要确认。 */
export type ToolSideEffect = 'read-only' | 'write-local' | 'external' | 'costly'

export const TOOL_SIDE_EFFECTS: readonly ToolSideEffect[] = [
  'read-only',
  'write-local',
  'external',
  'costly'
]

export type ToolParamType = 'string' | 'number' | 'boolean'

export interface ToolParamSpec {
  type: ToolParamType
  required?: boolean
  description?: string
}

export type ToolParams = Record<string, ToolParamSpec>

export type ToolResult =
  | { ok: true; value: unknown }
  | { ok: false; code: ToolErrorCode; message?: string }

export type ToolErrorCode =
  | 'E_TOOL_NOT_FOUND'
  | 'E_TOOL_BAD_ARGS'
  | 'E_TOOL_FAILED'
  | 'E_TOOL_TIMEOUT'

export interface ToolRunContext {
  /** 中断信号：调用方取消时，handler 应尽快退出。 */
  signal?: AbortSignal
}

export interface ToolDefinition {
  /** 小写字母开头，只含小写字母、数字、下划线、连字符。 */
  readonly name: string
  readonly description: string
  readonly sideEffect: ToolSideEffect
  readonly params: ToolParams
  /** 默认 30 秒。 */
  readonly timeoutMs?: number
  /** 是否必须由人确认后才可执行（`costly` / `external` 建议置 true）。 */
  readonly requiresApproval?: boolean
  handler(input: unknown, context: ToolRunContext): Promise<ToolResult>
}

/** 审计记录：只留参数**键名**，不留值——值可能含用户隐私或密钥。 */
export interface ToolRunRecord {
  toolName: string
  status: 'success' | 'error' | 'timeout'
  durationMs: number
  paramKeys: string[]
}

export interface ToolRunOptions {
  signal?: AbortSignal
  onRecord?: (record: ToolRunRecord) => void
}

export const DEFAULT_TOOL_TIMEOUT_MS = 30_000
