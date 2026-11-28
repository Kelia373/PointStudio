// ai/providers/opencodeGo —— OpenCode Go 推理网关。
//
// 与普通 OpenAI 兼容平台的差别：
// 1. 同一把 Key 下分两条线路（OpenAI Chat Completions / Anthropic Messages），
//    按模型名启发式选择，遇到 400 ModelProtocolUnsupported 自动切另一条重试一次；
// 2. 必须带 `x-opencode-session`，否则平台返回 400 MissingSessionID；
// 3. 必须带 `User-Agent: PointStudio/0.1`。
//
// baseUrl 可能是 .../inference/go/openai/v1 或 .../zen/go/openai/v1，
// 这里统一还原成 origin + 网关前缀，再按线路拼端点。
import {
  ProviderError,
  type ChatProvider,
  type ChatStreamRequest,
  type TokenUsageSample
} from './types.ts'
import { parseOpenAiSseStream } from './openaiCompatible.ts'

export const OPENCODE_GO_DEFAULT_BASE_URL = 'https://opencode.ai/inference/go/openai/v1'
export const OPENCODE_GO_DEFAULT_MODEL = 'kimi-k2.5'
export const OPENCODE_USER_AGENT = 'PointStudio/0.1'
/** 没有会话 id 时的稳定兜底，避免每次请求都被判成新会话。 */
export const OPENCODE_FALLBACK_SESSION = 'pointstudio-local'

const OPENAI_EFFORT: Record<string, string> = { low: 'low', mid: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }
const THINKING_BUDGET: Record<string, number> = { low: 1024, mid: 2048, high: 4096, xhigh: 8192, max: 16384 }

export type OpencodeWire = 'openai' | 'anthropic'

export interface OpencodeEndpoints {
  origin: string
  prefix: string
}

/** 还原网关前缀：默认 `/inference/go`，也兼容 `/zen/go` 与用户自定义 origin。 */
export function resolveOpencodeEndpoints(baseUrl?: string): OpencodeEndpoints {
  const raw = (baseUrl ?? '').trim() || OPENCODE_GO_DEFAULT_BASE_URL
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    url = new URL(OPENCODE_GO_DEFAULT_BASE_URL)
  }
  const matched = url.pathname.match(/^(.*?)\/(?:openai|anthropic)(?:\/v1)?\/?$/)
  const prefix = (matched ? matched[1] : url.pathname).replace(/\/+$/, '') || '/inference/go'
  return { origin: url.origin, prefix }
}

export function opencodeModelsUrl(baseUrl?: string): string {
  const { origin, prefix } = resolveOpencodeEndpoints(baseUrl)
  return `${origin}${prefix}/v1/models`
}

export function opencodeUsageUrl(baseUrl?: string): string {
  const { origin, prefix } = resolveOpencodeEndpoints(baseUrl)
  return `${origin}${prefix}/v1/usage`
}

export function opencodeChatUrl(baseUrl: string | undefined, wire: OpencodeWire): string {
  const { origin, prefix } = resolveOpencodeEndpoints(baseUrl)
  return wire === 'openai'
    ? `${origin}${prefix}/openai/v1/chat/completions`
    : `${origin}${prefix}/anthropic/v1/messages`
}

/** 模型名启发式：Claude 系走 Anthropic 线，其余走 OpenAI 线。 */
export function pickWire(model: string): OpencodeWire {
  return /claude/i.test(model) ? 'anthropic' : 'openai'
}

interface AnthropicEvent {
  type?: string
  delta?: { type?: string; text?: string }
  message?: { usage?: AnthropicUsage }
  usage?: AnthropicUsage
}

interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
}

/**
 * 解析 Anthropic Messages 的 SSE 流。
 *
 * 文本在 `content_block_delta` 的 `delta.text`；用量分散在
 * `message_start.message.usage`（输入）与 `message_delta.usage`（输出）里，
 * 这里累计到结束再回调一次。
 */
export async function* parseAnthropicSseStream(
  chunks: AsyncIterable<Uint8Array>,
  onUsage?: (usage: TokenUsageSample) => void
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheHitTokens = 0
  let finished = false

  const handle = (line: string): string | null => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('data:')) {
      return null
    }
    const payload = trimmed.slice('data:'.length).trim()
    if (payload === '' || payload === '[DONE]') {
      return null
    }
    let parsed: AnthropicEvent
    try {
      parsed = JSON.parse(payload) as AnthropicEvent
    } catch {
      return null
    }
    if (parsed.type === 'message_start' && parsed.message?.usage) {
      inputTokens = parsed.message.usage.input_tokens ?? inputTokens
      cacheHitTokens = parsed.message.usage.cache_read_input_tokens ?? cacheHitTokens
      return null
    }
    if (parsed.type === 'message_delta' && parsed.usage) {
      outputTokens = parsed.usage.output_tokens ?? outputTokens
      inputTokens = parsed.usage.input_tokens ?? inputTokens
      cacheHitTokens = parsed.usage.cache_read_input_tokens ?? cacheHitTokens
      return null
    }
    if (parsed.type === 'message_stop') {
      finished = true
      return null
    }
    if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
      return typeof parsed.delta.text === 'string' && parsed.delta.text !== ''
        ? parsed.delta.text
        : null
    }
    return null
  }

  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      const text = handle(line)
      if (text !== null) {
        yield text
      }
      if (finished) {
        break
      }
      newline = buffer.indexOf('\n')
    }
    if (finished) {
      break
    }
  }

  if (!finished) {
    buffer += decoder.decode()
    if (buffer.trim() !== '') {
      const text = handle(buffer.replace(/\r$/, ''))
      if (text !== null) {
        yield text
      }
    }
  }

  if (onUsage && inputTokens + outputTokens > 0) {
    onUsage({
      promptTokens: inputTokens,
      completionTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
      cacheHitTokens
    })
  }
}

export class OpencodeGoProvider implements ChatProvider {
  readonly id = 'opencode-go'

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, void, unknown> {
    if (request.apiKey.trim() === '') {
      throw new ProviderError('E_MISSING_KEY', '缺少 OpenCode Go API Key')
    }
    const wire = pickWire(request.model || OPENCODE_GO_DEFAULT_MODEL)
    try {
      yield* this.stream(request, wire)
    } catch (error) {
      // 平台判定模型属于另一条协议时自动切一次；其它错误原样上抛。
      if (error instanceof ProviderError && error.code === 'E_PROTOCOL') {
        yield* this.stream(request, wire === 'openai' ? 'anthropic' : 'openai')
        return
      }
      throw error
    }
  }

  private headers(request: ChatStreamRequest, wire: OpencodeWire): Record<string, string> {
    return {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${request.apiKey}`,
      'x-opencode-session': request.sessionId?.trim() || OPENCODE_FALLBACK_SESSION,
      'user-agent': OPENCODE_USER_AGENT,
      ...(wire === 'anthropic' ? { 'anthropic-version': '2023-06-01' } : {})
    }
  }

  private async *stream(
    request: ChatStreamRequest,
    wire: OpencodeWire
  ): AsyncGenerator<string, void, unknown> {
    const url = opencodeChatUrl(request.baseUrl || OPENCODE_GO_DEFAULT_BASE_URL, wire)
    const body =
      wire === 'openai' ? this.openAiBody(request) : this.anthropicBody(request)

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: this.headers(request, wire),
        body,
        signal: request.signal
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ProviderError('E_ABORTED', '请求已中断')
      }
      throw new ProviderError('E_STREAM', '连接 OpenCode Go 失败')
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      if (response.status === 400 && /ModelProtocolUnsupported/i.test(text)) {
        throw new ProviderError('E_PROTOCOL', '该模型需要另一条协议线路', 400)
      }
      throw new ProviderError('E_HTTP', `OpenCode Go 返回 ${response.status}`, response.status)
    }

    if (!response.body) {
      throw new ProviderError('E_STREAM', 'OpenCode Go 未返回流式响应体')
    }

    yield* wire === 'openai'
      ? parseOpenAiSseStream(response.body, request.onUsage)
      : parseAnthropicSseStream(response.body, request.onUsage)
  }

  private openAiBody(request: ChatStreamRequest): string {
    return JSON.stringify({
      model: request.model || OPENCODE_GO_DEFAULT_MODEL,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.params?.temperature !== undefined
        ? { temperature: request.params.temperature }
        : {}),
      ...(request.params?.maxTokens !== undefined ? { max_tokens: request.params.maxTokens } : {}),
      ...(request.params?.topP !== undefined ? { top_p: request.params.topP } : {}),
      ...(request.params?.effort &&
      request.effortMode === 'reasoning_effort' &&
      OPENAI_EFFORT[request.params.effort]
        ? { reasoning_effort: OPENAI_EFFORT[request.params.effort] }
        : {})
    })
  }

  private anthropicBody(request: ChatStreamRequest): string {
    const system = request.messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n')
    // Anthropic Messages 要求首条是 user：裁剪后的历史可能以 assistant 开头。
    const dialogue = request.messages
      .filter((message) => message.role !== 'system')
      .map((message) => ({ role: message.role, content: message.content }))
    while (dialogue.length > 0 && dialogue[0].role !== 'user') {
      dialogue.shift()
    }
    const budget =
      request.params?.effort && request.effortMode === 'thinking_budget'
        ? THINKING_BUDGET[request.params.effort]
        : null
    const maxTokens = request.params?.maxTokens ?? 4096
    return JSON.stringify({
      model: request.model || OPENCODE_GO_DEFAULT_MODEL,
      max_tokens: budget === null ? maxTokens : Math.max(maxTokens, budget + 1024),
      stream: true,
      messages: dialogue,
      ...(budget === null
        ? {}
        : { thinking: { type: 'enabled', budget_tokens: budget } }),
      ...(system === '' ? {} : { system }),
      ...(request.params?.temperature !== undefined
        ? { temperature: request.params.temperature }
        : {}),
      ...(request.params?.topP !== undefined ? { top_p: request.params.topP } : {})
    })
  }
}
