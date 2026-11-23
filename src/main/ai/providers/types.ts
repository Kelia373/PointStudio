// ai/providers/types —— 模型接入的「实现口」。
//
// 这是 ADR 0005 定下的接缝：上层（services / ipc / 界面）只认这个接口，
// 每接一个平台就新增一个实现文件，不修改调用方。
// 本文件禁止 import electron / react，也禁止自己读环境变量或配置文件——
// 密钥、baseUrl 一律由外壳注入进来。

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessageInput {
  role: ChatRole
  content: string
}

export interface ChatStreamParams {
  temperature?: number
  maxTokens?: number
  topP?: number
}

export interface ChatStreamRequest {
  apiKey: string
  baseUrl: string
  model: string
  messages: ChatMessageInput[]
  params?: ChatStreamParams
  signal?: AbortSignal
}

export interface ChatProvider {
  /** 平台标识，如 'deepseek'。用于日志与设置里选型，不用来分支业务。 */
  readonly id: string
  /** 产出**增量文本片段**；拼接与落库归调用方，provider 不产出半成品消息。 */
  streamChat(request: ChatStreamRequest): AsyncIterable<string>
}

export type ProviderErrorCode = 'E_MISSING_KEY' | 'E_HTTP' | 'E_STREAM' | 'E_ABORTED'

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
