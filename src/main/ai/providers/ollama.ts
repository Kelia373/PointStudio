// ai/providers/ollama —— 本地 Ollama 平台实现。
//
// 与 DeepSeek 的差别不止端点：Ollama 用 **NDJSON**（每行一个 JSON 对象），
// 不是 SSE，所以不能复用 `parseOpenAiSseStream`。这也正是 ADR 0005 说的
// 「每个平台自己写一遍协议细节」的代价——接口一样，传输格式各自为政。
//
// 另一个差别：本地模型不需要 API Key，因此 `requiresApiKey = false`，
// 引擎据此决定「没配 Key 也能走真模型」。
import {
  ProviderError,
  type ChatProvider,
  type ChatStreamRequest
} from './types.ts'
import { toOllamaMessages } from './wireMessages.ts'

export const OLLAMA_DEFAULT_BASE_URL = 'http://127.0.0.1:11434'
export const OLLAMA_DEFAULT_MODEL = 'qwen2.5'

interface OllamaChunk {
  message?: { content?: string; thinking?: string }
  done?: boolean
  error?: string
}

/**
 * 解析 Ollama 的 NDJSON 流。
 *
 * 边界与 SSE 版一致：半行、跨 chunk 的多字节字符、末尾无换行。
 */
export async function* parseOllamaNdjson(
  chunks: AsyncIterable<Uint8Array>,
  onReasoning?: (delta: string) => void
): AsyncGenerator<string, void, unknown> {
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const handle = (line: string): { done: boolean; text?: string } => {
    const trimmed = line.trim()
    if (trimmed === '') {
      return { done: false }
    }
    let parsed: OllamaChunk
    try {
      parsed = JSON.parse(trimmed) as OllamaChunk
    } catch {
      // 单行畸形不该炸整条流。
      return { done: false }
    }
    if (parsed.done === true) {
      return { done: true }
    }
    const thinking = parsed.message?.thinking
    if (onReasoning && typeof thinking === 'string' && thinking !== '') {
      onReasoning(thinking)
    }
    const content = parsed.message?.content
    return {
      done: false,
      text: typeof content === 'string' && content !== '' ? content : undefined
    }
  }

  for await (const chunk of chunks) {
    buffer += decoder.decode(chunk, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      const outcome = handle(line)
      if (outcome.done) {
        return
      }
      if (outcome.text !== undefined) {
        yield outcome.text
      }
      newline = buffer.indexOf('\n')
    }
  }

  buffer += decoder.decode()
  if (buffer.trim() !== '') {
    const outcome = handle(buffer.replace(/\r$/, ''))
    if (!outcome.done && outcome.text !== undefined) {
      yield outcome.text
    }
  }
}

export class OllamaProvider implements ChatProvider {
  readonly id = 'ollama'
  /** 本地模型不需要凭据：引擎据此允许「无 Key 走真模型」。 */
  readonly requiresApiKey = false

  async *streamChat(request: ChatStreamRequest): AsyncGenerator<string, void, unknown> {
    const baseUrl = (request.baseUrl || OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, '')
    const body = JSON.stringify({
      model: request.model || OLLAMA_DEFAULT_MODEL,
      messages: toOllamaMessages(request.messages),
      stream: true,
      options: {
        ...(request.params?.temperature !== undefined
          ? { temperature: request.params.temperature }
          : {}),
        ...(request.params?.topP !== undefined ? { top_p: request.params.topP } : {}),
        ...(request.params?.maxTokens !== undefined
          ? { num_predict: request.params.maxTokens }
          : {})
      }
    })

    let response: Response
    try {
      response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/x-ndjson',
          ...(request.apiKey.trim() === ''
            ? {}
            : { authorization: `Bearer ${request.apiKey}` })
        },
        body,
        signal: request.signal
      })
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new ProviderError('E_ABORTED', '请求已中断')
      }
      throw new ProviderError('E_STREAM', '连接本地模型服务失败')
    }

    if (!response.ok) {
      throw new ProviderError('E_HTTP', `本地模型服务返回 ${response.status}`, response.status)
    }
    if (!response.body) {
      throw new ProviderError('E_STREAM', '本地模型服务未返回流式响应体')
    }

    yield* parseOllamaNdjson(response.body, request.onReasoning)
  }
}
