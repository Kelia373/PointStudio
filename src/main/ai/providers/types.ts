// ai/providers/types —— 模型接入的「实现口」。
//
// 这是 ADR 0005 定下的接缝：上层（services / ipc / 界面）只认这个接口，
// 每接一个平台就新增一个实现文件，不修改调用方。
// 本文件禁止 import electron / react，也禁止自己读环境变量或配置文件——
// 密钥、baseUrl 一律由外壳注入进来。

import type {
  EffortWireModeDto,
  ReasoningEffortDto
} from '../../../shared/types/ipc.ts'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessageInput {
  role: ChatRole
  content: string
}

export interface ChatStreamParams {
  temperature?: number
  maxTokens?: number
  topP?: number
  /** 思考强度；缺省 / null 表示跟随模型默认。 */
  effort?: ReasoningEffortDto | null
}

export interface ChatStreamRequest {
  apiKey: string
  baseUrl: string
  model: string
  messages: ChatMessageInput[]
  params?: ChatStreamParams
  signal?: AbortSignal
  /** 用于 OpenCode Go 的 `x-opencode-session`；其他平台忽略。 */
  sessionId?: string
  /** 收到 SSE 尾帧 usage 时回调；不注入则不解析。 */
  onUsage?: (usage: TokenUsageSample) => void
  /** 这条通道该按什么方式传思考强度（由引擎按模型能力算好）。 */
  effortMode?: EffortWireModeDto
}

/** 一次真实调用的 token 用量（来自平台返回，不是估算）。 */
export interface TokenUsageSample {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** DeepSeek / OpenCode Go 的缓存命中 token；没有则为 0。 */
  cacheHitTokens: number
}

export interface ChatProvider {
  /** 平台标识，如 'deepseek'。用于日志与设置里选型，不用来分支业务。 */
  readonly id: string
  /**
   * 是否必须有凭据才能调用。默认 true。
   * 本地模型（Ollama）为 false——引擎据此允许「没有 Key 也走真模型」。
   */
  readonly requiresApiKey?: boolean
  /** 产出**增量文本片段**；拼接与落库归调用方，provider 不产出半成品消息。 */
  streamChat(request: ChatStreamRequest): AsyncIterable<string>
}

export type ProviderErrorCode =
  | 'E_MISSING_KEY'
  | 'E_HTTP'
  | 'E_STREAM'
  | 'E_ABORTED'
  | 'E_PROTOCOL'
  | 'E_RESPONSE'

export class ProviderError extends Error {
  readonly code: ProviderErrorCode
  readonly status?: number

  constructor(code: ProviderErrorCode, message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}
