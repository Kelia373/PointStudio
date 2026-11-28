// ai/providers/openaiCompatible —— OpenAI Chat Completions 线的通用实现。
//
// 覆盖 DeepSeek / OpenAI / Kimi / MiniMax / 智谱 / 通义 / 火山 / 硅基流动 /
// OpenRouter / xAI / Mistral 以及自定义服务商：它们都是同一套 SSE 协议，
// 差别只有 baseUrl、Key 与少量请求头。
//
// 本文件负责三件事：
// 1. 把 SSE 字节流解析成增量文本（顺带从尾帧抓真实 usage）；
// 2. 发请求时带上 stream_options.include_usage，让平台返回用量；
// 3. 错误归一到 ProviderError，不把平台原文抛给界面。
import {
  ProviderError,
  type ChatProvider,
  type ChatStreamRequest,
  type TokenUsageSample
} from './types.ts'

interface DeltaPayload {
  choices?: Array<{ delta?: { content?: string } }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_cache_hit_tokens?: number
  } | null
}

function usageFromPayload(parsed: DeltaPayload): TokenUsageSample | null {
  const usage = parsed.usage
  if (!usage) {
    return null
  }
  const promptTokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
  const completionTokens =
    typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0
  return {
    promptTokens,
    completionTokens,
    totalTokens:
      typeof usage.total_tokens === 'number'
        ? usage.total_tokens
        : promptTokens + completionTokens,
    cacheHitTokens:
      typeof usage.prompt_cache_hit_tokens === 'number' ? usage.prompt_cache_hit_tokens : 0
  }
}

/** 一行 SSE 的处理结果：要么产出文本，要么宣告结束，要么什么都不做。 */
interface LineOutcome {
  done: boolean
  texts: string[]
  usage: TokenUsageSample | null
}

function parseLine(line: string): LineOutcome {
  const trimmed = line.trim()
  if (trimmed === '' || !trimmed.startsWith('data:')) {
    return { done: false, texts: [], usage: null }
  }

  const payload = trimmed.slice('data:'.length).trim()
  if (payload === '[DONE]') {
    return { done: true, texts: [], usage: null }
  }

  let parsed: DeltaPayload
  try {
    parsed = JSON.parse(payload) as DeltaPayload
  } catch {
    // 单个畸形事件不该炸掉整条流：跳过它继续读后面的内容。
    return { done: false, texts: [], usage: null }
  }

  const content = parsed.choices?.[0]?.delta?.content
  return {
    done: false,
    texts: typeof content === 'string' && content !== '' ? [content] : [],
    usage: usageFromPayload(parsed)
  }
}

/**
 * 解析 OpenAI 兼容的 SSE 流。
 *
 * 三个必须处理的边界（每一条都有测试守着）：
 * 1. 一行 JSON 可能被网络切成两个 chunk → 用缓冲区攒到换行为止；
 * 2. 一个 UTF-8 字符可能被切在两个 chunk 之间 → TextDecoder 带 stream:true；
 * 3. 流结束时最后一行可能没有换行符 → 收尾时补处理缓冲区。
 *
 * onUsage 是可选回调：只在平台真的回了尾帧 usage 时触发一次，不影响文本产出。
 */
export async function* parseOpenAiSseStream(
  chunks: AsyncIterable<Uint8Array>,
  onUsage?: (usage: TokenUsageSample) => void
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let usageSent = false

  const emitUsage = (usage: TokenUsageSample | null): void => {
    if (!usage || !onUsage || usageSent) {
      return
    }
    usageSent = true
    onUsage(usage)
  }

  const drain = function* (flushAll: boolean): Generator<string, boolean, unknown> {
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      const outcome = parseLine(line)
      emitUsage(outcome.usage)
      if (outcome.done) {
        return true
      }
      yield* outcome.texts
      newlineIndex = buffer.indexOf('\n')
    }
    if (flushAll && buffer.trim() !== '') {
      const outcome = parseLine(buffer.replace(/\r$/, ''))
      emitUsage(outcome.usage)
      buffer = ''
      if (!outcome.done) {
        yield* outcome.texts
      }
    }
    return false
  }

  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true })
    const finished = yield* drain(false)
    if (finished) {
      return
    }
  }

  buffer += decoder.decode()
  yield* drain(true)
}

export interface OpenAiCompatibleOptions {
  id: string
  defaultBaseUrl: string
  defaultModel: string
  requiresApiKey?: boolean
  /** 额外请求头（例如 OpenCode Go 的 x-opencode-session）。 */
  headers?: (request: ChatStreamRequest) => Record<string, string>
}

/** 通用 OpenAI 兼容实现；DeepSeek 也基于它。 */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly id: string
  readonly requiresApiKey: boolean
  private readonly defaultBaseUrl: string
  private readonly defaultModel: string
  private readonly headers?: OpenAiCompatibleOptions['headers']

  constructor(options: OpenAiCompatibleOptions) {
    this.id = options.id
    this.requiresApiKey = options.requiresApiKey ?? true
    this.defaultBaseUrl = options.defaultBaseUrl
    this.defaultModel = options.defaultModel
    this.headers = options.headers
  }

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, void, unknown> {
    if (this.requiresApiKey && request.apiKey.trim() === '') {
      throw new ProviderError('E_MISSING_KEY', `缺少 ${this.id} API Key`)
    }

    const baseUrl = (request.baseUrl || this.defaultBaseUrl).replace(/\/+$/, '')
    const body = JSON.stringify({
      model: request.model || this.defaultModel,
      messages: request.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(request.params?.temperature !== undefined
        ? { temperature: request.params.temperature }
        : {}),
      ...(request.params?.maxTokens !== undefined ? { max_tokens: request.params.maxTokens } : {}),
      ...(request.params?.topP !== undefined ? { top_p: request.params.topP } : {})
    })

    let response: Response
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'text/event-stream',
          ...(request.apiKey.trim() === ''
            ? {}
            : { authorization: `Bearer ${request.apiKey}` }),
          ...(this.headers?.(request) ?? {})
        },
        body,
        signal: request.signal
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ProviderError('E_ABORTED', '请求已中断')
      }
      throw new ProviderError('E_STREAM', '连接模型平台失败')
    }

    if (!response.ok) {
      // 响应体可能含平台侧的诊断信息，只用于日志；对上层只暴露状态码。
      throw new ProviderError('E_HTTP', `模型平台返回 ${response.status}`, response.status)
    }

    if (!response.body) {
      throw new ProviderError('E_STREAM', '模型平台未返回流式响应体')
    }

    yield* parseOpenAiSseStream(response.body, request.onUsage)
  }
}
