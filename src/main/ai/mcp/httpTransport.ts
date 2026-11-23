// ai/mcp/httpTransport —— MCP 的 streamable-http 传输。
//
// 只做「发一条 JSON-RPC，把回来的消息交给订阅者」。
// 两种响应形态都要支持：
//   1. 普通 JSON（一次性结果）；
//   2. text/event-stream（逐条 `data: {...}`，用于进度通知与长任务）。
//
// 为什么不用 stdio：那要 spawn 子进程，而本机工作区禁止 spawn（EPERM）。
// HTTP 传输可以用本地假服务完整验证，所以先做它。

export interface McpHttpOptions {
  /** 附加请求头，例如鉴权。 */
  headers?: Record<string, string>
  timeoutMs?: number
}

export class McpHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'McpHttpError'
    this.status = status
  }
}

export class McpHttpTransport {
  private readonly url: string
  private readonly options: McpHttpOptions
  private readonly handlers = new Set<(message: unknown) => void>()

  constructor(url: string, options: McpHttpOptions = {}) {
    this.url = url
    this.options = options
  }

  async send(message: unknown): Promise<void> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 30_000)

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // 同时接受两种形态：服务端按能力回其中一种。
          accept: 'application/json, text/event-stream',
          ...this.options.headers
        },
        body: JSON.stringify(message),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new McpHttpError(response.status, `E_MCP_HTTP_${response.status}`)
      }

      const text = await response.text()
      if (text.trim() === '') {
        return
      }

      const isEventStream = (response.headers.get('content-type') ?? '').includes('text/event-stream')
      if (isEventStream) {
        this.emitSse(text)
      } else {
        this.deliver(text)
      }
    } finally {
      clearTimeout(timer)
    }
  }

  onMessage(handler: (message: unknown) => void): () => void {
    this.handlers.add(handler)
    return () => {
      this.handlers.delete(handler)
    }
  }

  private emitSse(text: string): void {
    for (const line of text.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) {
        continue
      }
      this.deliver(trimmed.slice('data:'.length).trim())
    }
  }

  private deliver(payload: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      // 畸形帧跳过，不炸整条通道——与 SSE/NDJSON 解析器同一取向。
      return
    }
    for (const handler of this.handlers) {
      handler(parsed)
    }
  }
}
