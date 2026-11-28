// ai/domain/conversation —— 会话与消息的领域模型与纯规则。
//
// 这一层只有数据和判断：不允许读写文件、不允许 import electron。
// 会话（Conversation）是「一组消息的容器」；消息（Message）一旦写入就不再变，
// 编辑是产生新内容并刷新时间，不是原地改写历史语义。

import type { ReasoningEffortDto } from '../../../shared/types/ipc.ts'

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'complete' | 'error'

/** 会话级采样参数：只存显式设置过的项，缺省继承助手 / 全局。 */
export interface ConversationParams {
  temperature?: number
  maxTokens?: number
  topP?: number
  /** 思考强度；缺省 / null 表示跟随模型默认。 */
  effort?: ReasoningEffortDto | null
}

export interface Conversation {
  id: string
  title: string
  /** 绑定的助手；null 表示不用助手（裸聊天）。 */
  assistantId: string | null
  /** 挂载的项目；缺省或 null 表示未挂载（主聊天 / 临时会话）。 */
  workspaceId?: string | null
  /**
   * 会话级模型覆盖。空表示跟随助手 / 全局默认。
   * 模型是「这次执行用什么」，所以跟着会话走，而不是全局一刀切。
   */
  model?: string | null
  /** 会话级服务商覆盖；缺省跟随助手绑定 / 全局默认。 */
  providerId?: string | null
  /** 会话级采样参数覆盖，优先级高于助手与全局默认。 */
  params?: ConversationParams
  createdAt: string
  updatedAt: string
}

/** 回答里引用过的检索片段。只存定位信息，不存正文——正文可能很大且会变。 */
export interface MessageReference {
  /** 形如 `path#3`，可回指到具体块。 */
  chunkId: string
  source: string
}

export interface Message {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  status: MessageStatus
  /** 可选：旧消息没有这个字段，读取时必须容忍缺失。 */
  references?: MessageReference[]
  createdAt: string
  updatedAt: string
}

export const DEFAULT_CONVERSATION_TITLE = '新会话'
export const TITLE_MAX_LENGTH = 30

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

/** 折叠空白：换行、连续空格都压成一个空格，用于把首条消息变成标题。 */
export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * 由文本派生标题。按**码点**截断，避免把 emoji 劈成半个。
 * 空文本回落到默认标题——标题不允许为空，否则列表里会出现空白行。
 */
export function deriveTitle(text: string): string {
  const collapsed = collapseWhitespace(text)
  if (collapsed === '') {
    return DEFAULT_CONVERSATION_TITLE
  }
  const codePoints = Array.from(collapsed)
  return codePoints.length > TITLE_MAX_LENGTH
    ? codePoints.slice(0, TITLE_MAX_LENGTH).join('')
    : collapsed
}

export function validateTitle(raw: string): Validation<string> {
  const title = collapseWhitespace(raw ?? '')
  if (title === '') {
    return { ok: false, errors: ['E_TITLE_REQUIRED'] }
  }
  if (Array.from(title).length > TITLE_MAX_LENGTH) {
    return { ok: false, errors: ['E_TITLE_TOO_LONG'] }
  }
  return { ok: true, value: title }
}

export function validateMessageContent(raw: string): Validation<string> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { ok: false, errors: ['E_EMPTY_CONTENT'] }
  }
  return { ok: true, value: raw }
}

export function isMessageRole(value: unknown): value is MessageRole {
  return value === 'user' || value === 'assistant'
}

/** 模型名：允许空（表示跟随默认），否则必须是 1~120 字的可见字符。 */
export function validateModelId(value: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, value: null }
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'E_BAD_MODEL' }
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return { ok: true, value: null }
  }
  if (trimmed.length > 120) {
    return { ok: false, error: 'E_BAD_MODEL' }
  }
  return { ok: true, value: trimmed }
}

/** 服务商 id：允许空（跟随默认），否则只认小写字母/数字/下划线/短横线。 */
export function validateProviderId(
  value: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, value: null }
  }
  if (typeof value !== 'string') {
    return { ok: false, error: 'E_BAD_PROVIDER' }
  }
  const trimmed = value.trim()
  if (trimmed === '') {
    return { ok: true, value: null }
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,48}$/.test(trimmed)) {
    return { ok: false, error: 'E_BAD_PROVIDER' }
  }
  return { ok: true, value: trimmed }
}

/**
 * 采样参数：只认三个数字字段，范围和类型都要卡住。
 * 越界值不是「夹一下」而是报错——静默改值会让人对不上自己设的东西。
 */
export function validateConversationParams(
  value: unknown
): { ok: true; value: ConversationParams } | { ok: false; error: string } {
  if (value === null || value === undefined) {
    return { ok: true, value: {} }
  }
  if (typeof value !== 'object') {
    return { ok: false, error: 'E_BAD_PARAMS' }
  }

  const input = value as Record<string, unknown>
  const result: ConversationParams = {}

  const effort = input['effort']
  if (effort !== undefined && effort !== null) {
    if (
      typeof effort !== 'string' ||
      !['low', 'mid', 'high', 'xhigh', 'max'].includes(effort)
    ) {
      return { ok: false, error: 'E_BAD_PARAMS' }
    }
    result.effort = effort as ReasoningEffortDto
  }

  const ranges: Array<['temperature' | 'topP' | 'maxTokens', number, number]> = [
    ['temperature', 0, 2],
    ['topP', 0, 1],
    ['maxTokens', 1, 32_000]
  ]

  for (const [key, min, max] of ranges) {
    const raw = input[key]
    if (raw === undefined || raw === null) {
      continue
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < min || raw > max) {
      return { ok: false, error: 'E_BAD_PARAMS' }
    }
    result[key] = raw
  }

  return { ok: true, value: result }
}
