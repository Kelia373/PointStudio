// ai/domain/backup —— 备份文档的格式与解析。
//
// 备份是「带走数据」的唯一保证，所以格式必须自带版本号：
// 将来格式变了，旧程序读到新文件要明确拒绝，而不是读到一半写坏。
import type { Assistant } from './assistant.ts'
import type { Conversation, Message } from './conversation.ts'

export const BACKUP_VERSION = 1

export interface BackupPayload {
  conversations: Conversation[]
  messages: Message[]
  assistants: Assistant[]
}

export interface BackupDocument extends BackupPayload {
  version: number
  exportedAt: string
}

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export function createBackup(payload: BackupPayload, context: { now: string }): BackupDocument {
  return {
    version: BACKUP_VERSION,
    exportedAt: context.now,
    conversations: payload.conversations,
    messages: payload.messages,
    assistants: payload.assistants
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isConversation(value: unknown): value is Conversation {
  if (!isObject(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    (value.assistantId === null || typeof value.assistantId === 'string') &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function isMessage(value: unknown): value is Message {
  if (!isObject(value)) {
    return false
  }
  return (
    typeof value.id === 'string' &&
    typeof value.conversationId === 'string' &&
    (value.role === 'user' || value.role === 'assistant') &&
    typeof value.content === 'string' &&
    (value.status === 'complete' || value.status === 'error') &&
    (value.references === undefined ||
      (Array.isArray(value.references) &&
        value.references.every(
          (item) =>
            isObject(item) && typeof item.chunkId === 'string' && typeof item.source === 'string'
        ))) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

function isAssistant(value: unknown): value is Assistant {
  if (!isObject(value)) {
    return false
  }
  const params = value.params
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.systemPrompt === 'string' &&
    (value.providerId === null || typeof value.providerId === 'string') &&
    (value.modelId === null || typeof value.modelId === 'string') &&
    isObject(params) &&
    typeof params.temperature === 'number' &&
    typeof params.maxTokens === 'number' &&
    typeof params.topP === 'number' &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  )
}

export function parseBackup(text: string): Validation<BackupDocument> {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { ok: false, errors: ['E_BACKUP_NOT_JSON'] }
  }

  if (!isObject(parsed)) {
    return { ok: false, errors: ['E_BACKUP_SHAPE'] }
  }
  if (parsed.version !== BACKUP_VERSION) {
    // 版本先判：结构可能完全不同，先按新版本乱读一遍只会更糟。
    return { ok: false, errors: ['E_BACKUP_VERSION'] }
  }

  const { conversations, messages, assistants } = parsed
  if (!Array.isArray(conversations) || !Array.isArray(messages) || !Array.isArray(assistants)) {
    return { ok: false, errors: ['E_BACKUP_SHAPE'] }
  }

  if (
    !conversations.every(isConversation) ||
    !messages.every(isMessage) ||
    !assistants.every(isAssistant)
  ) {
    return { ok: false, errors: ['E_BACKUP_SHAPE'] }
  }

  return {
    ok: true,
    value: {
      version: BACKUP_VERSION,
      exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
      conversations,
      messages,
      assistants
    }
  }
}

export function summarizeBackup(doc: BackupDocument): {
  conversations: number
  messages: number
  assistants: number
} {
  return {
    conversations: doc.conversations.length,
    messages: doc.messages.length,
    assistants: doc.assistants.length
  }
}
