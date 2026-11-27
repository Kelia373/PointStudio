// ai/providers/deepseek —— DeepSeek 平台实现（OpenAI 兼容协议）。
//
// 只做一件事：把 HTTP + SSE 的字节流，变成「增量文本片段」。
// 不做重试、不做计费、不做消息落库——那些属于上层。
import {
  ProviderError,
  type ChatProvider,
  type ChatStreamRequest
} from './types.ts'

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat'

interface DeltaPayload {
  choices?: Array<{ delta?: { content?: string } }>
}

/** 一行 SSE 的处理结果：要么产出文本，要么宣告结束，要么什么都不做。 */
interface LineOutcome {
  done: boolean
  texts: string[]
}

function parseLine(line: string): LineOutcome {
  const trimmed = line.trim()
  if (trimmed === '' || !trimmed.startsWith('data:')) {
    return { done: false, texts: [] }
  }

  const payload = trimmed.slice('data:'.length).trim()
  if (payload === '[DONE]') {
    return { done: true, texts: [] }
  }

  let parsed: DeltaPayload
  try {
    parsed = JSON.parse(payload) as DeltaPayload
  } catch {
    // 单个畸形事件不该炸掉整条流：跳过它继续读后面的内容。
    return { done: false, texts: [] }
  }

  const content = parsed.choices?.[0]?.delta?.content
  return { done: false, texts: typeof content === 'string' && content !== '' ? [content] : [] }
}

/**
 * 解析 OpenAI 兼容的 SSE 流。
 *
 * 三个必须处理的边界（每一条都有测试守着）：
 * 1. 一行 JSON 可能被网络切成两个 chunk → 用缓冲区攒到换行为止；
 * 2. 一个 UTF-8 字符可能被切在两个 chunk 之间 → TextDecoder 带 stream:true；
 * 3. 流结束时最后一行可能没有换行符 → 收尾时补处理缓冲区。
 */
export async function* parseOpenAiSseStream(
  chunks: AsyncIterable<Uint8Array>
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const drain = function* (flushAll: boolean): Generator<string, boolean, unknown> {
    let newlineIndex = buffer.indexOf('\n')
    while (newlineIndex >= 0) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, '')
      buffer = buffer.slice(newlineIndex + 1)
      const outcome = parseLine(line)
      if (outcome.done) {
        return true
      }
      yield* outcome.texts
      newlineIndex = buffer.indexOf('\n')
    }
    if (flushAll && buffer.trim() !== '') {
      const outcome = parseLine(buffer.replace(/\r$/, ''))
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

export class DeepSeekProvider implements ChatProvider {
  readonly id = 'deepseek'

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, void, unknown> {
    if (request.apiKey.trim() === '') {
      throw new ProviderError('E_MISSING_KEY', '缺少 DeepSeek API Key')
    }

    const baseUrl = (request.baseUrl || DEEPSEEK_DEFAULT_BASE_URL).replace(/\/+$/, '')
    const body = JSON.stringify({
      model: request.model || DEEPSEEK_DEFAULT_MODEL,
      messages: request.messages,
      stream: true,
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
          authorization: `Bearer ${request.apiKey}`
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

    yield* parseOpenAiSseStream(response.body)
  }
}
