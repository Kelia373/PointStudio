// ai/tools/builtin —— 内置只读工具。
//
// 三个工具刻意都选只读：先把「能执行」这条路走通，再谈有副作用的工具。
//
// 两条硬约束：
// 1. 不做 IO。需要读文件时通过注入的 `readTextFile` 读——本目录不 import fs，
//    也不 import electron，因此可脱离运行环境单测。
// 2. 路径不许出工作区。绝对路径、`..` 穿越一律拒绝，且拒绝时**不发生读取**。
import { isSafeRelativePath } from '../../../utils/paths.ts'
import type { ToolDefinition } from '../types.ts'

export interface BuiltinToolDeps {
  /** 注入时钟，测试可固定。 */
  clock?: () => Date
  /** 注入文件读取器；不提供则 read_text_file 不可用。 */
  readTextFile?: (relativePath: string) => Promise<string>
  /** 单文件读取上限（字符）。 */
  maxBytes?: number
}

export const DEFAULT_MAX_READ_BYTES = 100_000

/**
 * 四则运算求值：递归下降，手写，**不用 eval**。
 * 支持 + - * / 、括号、小数、一元负号；其它字符一律视为非法。
 */
export function evaluateExpression(input: string): number {
  let index = 0
  const text = input.replace(/\s+/g, '')

  const peek = (): string => text[index] ?? ''

  const parseNumber = (): number => {
    const start = index
    while (/[0-9.]/.test(peek())) {
      index += 1
    }
    if (start === index) {
      throw new Error('E_EXPR_INVALID')
    }
    const value = Number(text.slice(start, index))
    if (!Number.isFinite(value)) {
      throw new Error('E_EXPR_INVALID')
    }
    return value
  }

  const parseFactor = (): number => {
    if (peek() === '-') {
      index += 1
      return -parseFactor()
    }
    if (peek() === '(') {
      index += 1
      const value = parseSum()
      if (peek() !== ')') {
        throw new Error('E_EXPR_INVALID')
      }
      index += 1
      return value
    }
    return parseNumber()
  }

  const parseProduct = (): number => {
    let value = parseFactor()
    while (peek() === '*' || peek() === '/') {
      const operator = peek()
      index += 1
      const right = parseFactor()
      if (operator === '/') {
        if (right === 0) {
          throw new Error('E_DIVIDE_BY_ZERO')
        }
        value /= right
      } else {
        value *= right
      }
    }
    return value
  }

  function parseSum(): number {
    let value = parseProduct()
    while (peek() === '+' || peek() === '-') {
      const operator = peek()
      index += 1
      const right = parseProduct()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }

  const result = parseSum()
  if (index !== text.length) {
    throw new Error('E_EXPR_INVALID')
  }
  return result
}

export function createBuiltinTools(deps: BuiltinToolDeps = {}): ToolDefinition[] {
  const clock = deps.clock ?? ((): Date => new Date())
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_READ_BYTES

  const now: ToolDefinition = {
    name: 'now',
    description: '返回当前时间（ISO 8601）',
    sideEffect: 'read-only',
    params: {},
    async handler() {
      return { ok: true, value: { iso: clock().toISOString() } }
    }
  }

  const calc: ToolDefinition = {
    name: 'calc',
    description: '计算四则运算表达式（支持括号、小数、负号）',
    sideEffect: 'read-only',
    params: { expression: { type: 'string', required: true, description: '如 (1+2)*3' } },
    async handler(input) {
      const expression = (input as { expression: string }).expression
      try {
        return { ok: true, value: { result: evaluateExpression(expression) } }
      } catch {
        // 表达式错误属于输入问题，归一为参数错误；不把解析器内部细节透出去。
        return { ok: false, code: 'E_TOOL_BAD_ARGS' }
      }
    }
  }

  const readTextFile: ToolDefinition = {
    name: 'read_text_file',
    description: '读取工作区内的文本文件（只读，禁止越界）',
    sideEffect: 'read-only',
    params: { path: { type: 'string', required: true, description: '工作区内的相对路径' } },
    async handler(input) {
      const path = (input as { path: string }).path
      if (!isSafeRelativePath(path) || !deps.readTextFile) {
        return { ok: false, code: 'E_TOOL_BAD_ARGS' }
      }
      try {
        const content = await deps.readTextFile(path)
        if (content.length > maxBytes) {
          return { ok: false, code: 'E_TOOL_FAILED' }
        }
        return { ok: true, value: { path, content } }
      } catch {
        return { ok: false, code: 'E_TOOL_FAILED' }
      }
    }
  }

  return [calc, now, readTextFile]
}
