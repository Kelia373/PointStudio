// ipc/assistant —— 助手的跨进程边界。
//
// 与 conversation 同一套路：校验参数 → 委托 service → 领域错误码原样返回。
import { ipcMain } from 'electron'

import {
  ASSISTANT_CHANNELS,
  type AssistantBridge,
  type AssistantDto,
  type AssistantDraftRequest,
  type IpcResult
} from '../../shared/types/ipc.ts'
import type { Assistant, AssistantDraft } from '../ai/domain/assistant.ts'
import type { AssistantService } from '../services/assistantService.ts'
import { removeAssistantAndUnbind } from '../services/assistantCleanup.ts'
import type { ConversationService } from '../services/conversationService.ts'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toDto(assistant: Assistant): AssistantDto {
  return {
    id: assistant.id,
    name: assistant.name,
    systemPrompt: assistant.systemPrompt,
    providerId: assistant.providerId,
    modelId: assistant.modelId,
    params: assistant.params,
    createdAt: assistant.createdAt,
    updatedAt: assistant.updatedAt
  }
}

function toDraft(value: unknown): AssistantDraft | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const input = value as Partial<AssistantDraftRequest>
  if (typeof input.name !== 'string') {
    return null
  }
  if (input.systemPrompt !== undefined && typeof input.systemPrompt !== 'string') {
    return null
  }
  if (input.modelId !== undefined && input.modelId !== null && typeof input.modelId !== 'string') {
    return null
  }
  if (input.providerId !== undefined && input.providerId !== null && typeof input.providerId !== 'string') {
    return null
  }
  if (input.params !== undefined && (typeof input.params !== 'object' || input.params === null)) {
    return null
  }

  return {
    name: input.name,
    systemPrompt: input.systemPrompt,
    modelId: input.modelId ?? null,
    providerId: input.providerId ?? null,
    params: input.params
  }
}

export interface AssistantIpcOptions {
  assistants: AssistantService
  /** 删除助手时要解绑引用它的会话，因此需要会话服务。 */
  conversations: ConversationService
}

export function registerAssistantIpc(options: AssistantIpcOptions): void {
  const service = options.assistants

  ipcMain.handle(ASSISTANT_CHANNELS.list, async (): Promise<AssistantDto[]> => {
    const items = await service.list()
    return items.map(toDto)
  })

  ipcMain.handle(
    ASSISTANT_CHANNELS.create,
    async (_event, request: unknown): Promise<IpcResult<AssistantDto>> => {
      const draft = toDraft(request)
      if (!draft) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await service.create(draft)
      return result.ok
        ? { ok: true, value: toDto(result.value) }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    ASSISTANT_CHANNELS.update,
    async (_event, id: unknown, request: unknown): Promise<IpcResult<AssistantDto>> => {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const draft = toDraft(request)
      if (!draft) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await service.update(id, draft)
      return result.ok
        ? { ok: true, value: toDto(result.value) }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    ASSISTANT_CHANNELS.remove,
    async (_event, id: unknown): Promise<IpcResult<true>> => {
      if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await removeAssistantAndUnbind(service, options.conversations, id)
      return result.ok ? { ok: true, value: true } : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )
}

/** preload 侧实现必须满足的形状（编译期校验）。 */
export type { AssistantBridge }
