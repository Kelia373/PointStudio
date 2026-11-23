// ipc/conversation —— 会话与消息的跨进程边界。
//
// 与 chat 的区别：这里全是「一问一答」的请求，没有推流，所以一律用 invoke。
// 边界只做：校验参数 → 委托 service → 把领域错误码原样回去（不翻译成文案）。
import { ipcMain } from 'electron'

import {
  CONVERSATION_CHANNELS,
  type ConversationDto,
  type CreateConversationRequest,
  type IpcResult,
  type MessageDto
} from '../../shared/types/ipc.ts'
import type { Conversation, Message } from '../ai/domain/conversation.ts'
import type { ConversationService } from '../services/conversationService.ts'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toConversationDto(conversation: Conversation): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    assistantId: conversation.assistantId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt
  }
}

function toMessageDto(message: Message): MessageDto {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    status: message.status,
    ...(message.references ? { references: message.references } : {}),
    createdAt: message.createdAt
  }
}

function isCreateRequest(value: unknown): value is CreateConversationRequest {
  if (value === undefined) {
    return true
  }
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const title = (value as CreateConversationRequest).title
  return title === undefined || typeof title === 'string'
}

export interface ConversationIpcOptions {
  conversations: ConversationService
}

export function registerConversationIpc(options: ConversationIpcOptions): void {
  const service = options.conversations

  ipcMain.handle(CONVERSATION_CHANNELS.list, async (): Promise<ConversationDto[]> => {
    const items = await service.list()
    return items.map(toConversationDto)
  })

  ipcMain.handle(
    CONVERSATION_CHANNELS.create,
    async (_event, request: unknown): Promise<IpcResult<ConversationDto>> => {
      if (!isCreateRequest(request)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await service.create(request ?? {})
      return result.ok
        ? { ok: true, value: toConversationDto(result.value) }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.rename,
    async (_event, id: unknown, title: unknown): Promise<IpcResult<ConversationDto>> => {
      if (typeof id !== 'string' || !ID_PATTERN.test(id) || typeof title !== 'string') {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await service.rename(id, title)
      return result.ok
        ? { ok: true, value: toConversationDto(result.value) }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.remove,
    async (_event, id: unknown): Promise<IpcResult<true>> => {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await service.remove(id)
      return result.ok ? { ok: true, value: true } : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.setAssistant,
    async (_event, id: unknown, assistantId: unknown): Promise<IpcResult<ConversationDto>> => {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      if (assistantId !== null && (typeof assistantId !== 'string' || !ID_PATTERN.test(assistantId))) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await service.setAssistant(id, assistantId)
      return result.ok
        ? { ok: true, value: toConversationDto(result.value) }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.messages,
    async (_event, id: unknown): Promise<MessageDto[]> => {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        return []
      }
      const items = await service.listMessages(id)
      return items.map(toMessageDto)
    }
  )
}
