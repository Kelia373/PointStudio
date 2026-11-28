// ipc/conversation —— 会话与消息的跨进程边界。
//
// 与 chat 的区别：这里全是「一问一答」的请求，没有推流，所以一律用 invoke。
// 边界只做：校验参数 → 委托 service → 把领域错误码原样回去（不翻译成文案）。
import { ipcMain } from 'electron'

import {
  CONVERSATION_CHANNELS,
  type ConversationDto,
  type IpcResult,
  type MessageDto
} from '../../shared/types/ipc.ts'
import type { Conversation, Message } from '../ai/domain/conversation.ts'
import type { ConversationService } from '../services/conversationService.ts'
import { renderConversationMarkdown } from '../services/exportService.ts'
import { deleteTurn } from '../services/turnService.ts'
import { isConversationModelPatch, isCreateConversationRequest, isUuid } from './validators.ts'

function toConversationDto(conversation: Conversation): ConversationDto {
  return {
    id: conversation.id,
    title: conversation.title,
    assistantId: conversation.assistantId,
    ...(conversation.workspaceId !== undefined ? { workspaceId: conversation.workspaceId } : {}),
    ...(conversation.model ? { model: conversation.model } : {}),
    ...(conversation.providerId ? { providerId: conversation.providerId } : {}),
    ...(conversation.groupId ? { groupId: conversation.groupId } : {}),
    ...(conversation.params ? { params: conversation.params } : {}),
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
      if (!isCreateConversationRequest(request)) {
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
      if (typeof id !== 'string' || !isUuid(id) || typeof title !== 'string') {
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
      if (typeof id !== 'string' || !isUuid(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await service.remove(id)
      return result.ok ? { ok: true, value: true } : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.setAssistant,
    async (_event, id: unknown, assistantId: unknown): Promise<IpcResult<ConversationDto>> => {
      if (typeof id !== 'string' || !isUuid(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      if (assistantId !== null && (typeof assistantId !== 'string' || !isUuid(assistantId))) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await service.setAssistant(id, assistantId)
      return result.ok
        ? { ok: true, value: toConversationDto(result.value) }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.setModel,
    async (_event, id: unknown, patch: unknown): Promise<IpcResult<ConversationDto>> => {
      if (typeof id !== 'string' || !isUuid(id) || !isConversationModelPatch(patch)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const saved = await service.setModel(id, patch)
      return saved.ok
        ? { ok: true, value: toConversationDto(saved.value) }
        : { ok: false, code: saved.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.deleteTurn,
    async (
      _event,
      conversationId: unknown,
      messageId: unknown
    ): Promise<IpcResult<{ removed: number }>> => {
      if (
        typeof conversationId !== 'string' ||
        !isUuid(conversationId) ||
        typeof messageId !== 'string' ||
        !isUuid(messageId)
      ) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await deleteTurn(service, conversationId, messageId)
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.exportMarkdown,
    async (_event, id: unknown): Promise<IpcResult<string>> => {
      if (typeof id !== 'string' || !isUuid(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const conversation = await service.get(id)
      if (!conversation) {
        return { ok: false, code: 'E_NOT_FOUND' }
      }
      const messages = await service.listMessages(id)
      return { ok: true, value: renderConversationMarkdown(conversation, messages) }
    }
  )

  ipcMain.handle(
    CONVERSATION_CHANNELS.messages,
    async (_event, id: unknown): Promise<MessageDto[]> => {
      if (typeof id !== 'string' || !isUuid(id)) {
        return []
      }
      const items = await service.listMessages(id)
      return items.map(toMessageDto)
    }
  )
}
