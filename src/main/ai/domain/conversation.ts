// ai/domain/conversation —— 会话与消息的领域模型与纯规则。
//
// 这一层只有数据和判断：不允许读写文件、不允许 import electron。
// 会话（Conversation）是「一组消息的容器」；消息（Message）一旦写入就不再变，
// 编辑是产生新内容并刷新时间，不是原地改写历史语义。

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'complete' | 'error'

export interface Conversation {
  id: string
  title: string
  /** 绑定的助手；null 表示不用助手（裸聊天）。 */
  assistantId: string | null
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
