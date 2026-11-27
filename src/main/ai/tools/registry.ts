// ai/tools/registry —— 工具注册表。
//
// 三件事：注册时守住协议（名字、副作用、必填参数），调用时守住边界
// （参数校验、超时、异常归一），每次调用留一条不含参数值的审计记录。
import {
  DEFAULT_TOOL_TIMEOUT_MS,
  TOOL_SIDE_EFFECTS,
  type ToolDefinition,
  type ToolResult,
  type ToolRunOptions,
  type ToolSideEffect
} from './types.ts'

const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void {
    if (!NAME_PATTERN.test(tool.name)) {
      throw new Error(`E_TOOL_BAD_NAME: ${tool.name}`)
    }
    if (!TOOL_SIDE_EFFECTS.includes(tool.sideEffect)) {
      throw new Error(`E_TOOL_BAD_SIDE_EFFECT: ${String(tool.sideEffect)}`)
    }
    if (this.tools.has(tool.name)) {
      throw new Error(`E_TOOL_DUPLICATE: ${tool.name}`)
    }
    this.tools.set(tool.name, tool)
  }

  /** 移除工具（断开外部服务时用）。返回是否真的移除了。 */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  /** 只读能力清单，供规划阶段展示「这个工作台能做什么」。 */
  describe(): Array<{
    name: string
    description: string
    sideEffect: ToolSideEffect
    requiresApproval: boolean
    params: string[]
  }> {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      sideEffect: tool.sideEffect,
      requiresApproval:
        tool.requiresApproval ??
        (tool.sideEffect === 'costly' || tool.sideEffect === 'external'),
      params: Object.keys(tool.params).sort()
    }))
  }

  async run(name: string, input: unknown, options: ToolRunOptions = {}): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { ok: false, code: 'E_TOOL_NOT_FOUND' }
    }
    if (!matchesParams(tool, input)) {
      return { ok: false, code: 'E_TOOL_BAD_ARGS' }
    }

    const started = Date.now()
    const timeoutMs = tool.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS
    const keys = inputObject(input) ? Object.keys(input as Record<string, unknown>).sort() : []

    try {
      const value = await withTimeout(
        tool.handler(input, { signal: options.signal }),
        timeoutMs,
        options.signal
      )
      options.onRecord?.({
        toolName: name,
        status: 'success',
        durationMs: Date.now() - started,
        paramKeys: keys
      })
      return value
    } catch (error) {
      const timedOut = error instanceof ToolTimeoutError
      options.onRecord?.({
        toolName: name,
        status: timedOut ? 'timeout' : 'error',
        durationMs: Date.now() - started,
        paramKeys: keys
      })
      // 不把原始异常透给计划层：内部堆栈只进日志，调用方只拿错误码。
      return { ok: false, code: timedOut ? 'E_TOOL_TIMEOUT' : 'E_TOOL_FAILED' }
    }
  }
}

class ToolTimeoutError extends Error {
  constructor() {
    super('E_TOOL_TIMEOUT')
    this.name = 'ToolTimeoutError'
  }
}

function inputObject(input: unknown): boolean {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function matchesParams(tool: ToolDefinition, input: unknown): boolean {
  const required = Object.entries(tool.params).filter(([, spec]) => spec.required === true)
  if (required.length > 0 && !inputObject(input)) {
    return false
  }
  if (!inputObject(input)) {
    return Object.keys(tool.params).length === 0
  }

  const values = input as Record<string, unknown>
  for (const [key, spec] of Object.entries(tool.params)) {
    const value = values[key]
    if (value === undefined) {
      if (spec.required === true) {
        return false
      }
      continue
    }
    if (typeof value !== spec.type) {
      return false
    }
  }
  return true
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ToolTimeoutError()), timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = (): void => {
      cleanup()
      reject(new ToolTimeoutError())
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    promise.then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error) => {
        cleanup()
        reject(error)
      }
    )
  })
}
