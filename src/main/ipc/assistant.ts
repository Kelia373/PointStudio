// ipc/assistant —— 助手的跨进程边界。
//
// 与 conversation 同一套路：校验参数 → 委托 service → 领域错误码原样返回。
import { ipcMain } from 'electron'

import {
  ASSISTANT_CHANNELS,
  type AssistantBridge,
  type AssistantDto,
  type IpcResult
} from '../../shared/types/ipc.ts'
import type { Assistant } from '../ai/domain/assistant.ts'
import { isAssistantDraft, isUuid } from './validators.ts'
import type { AssistantService } from '../services/assistantService.ts'
import { removeAssistantAndUnbind } from '../services/assistantCleanup.ts'
import type { ConversationService } from '../services/conversationService.ts'

function toDto(assistant: Assistant): AssistantDto {
  return {
    id: assistant.id,
    name: assistant.name,
    systemPrompt: assistant.systemPrompt,
    providerId: assistant.providerId,
    modelId: assistant.modelId,
    params: assistant.params,
    // 旧记录没有这个字段：缺省即启用，不是「未知」
    enabled: assistant.enabled !== false,
    createdAt: assistant.createdAt,
    updatedAt: assistant.updatedAt
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
      const draft = isAssistantDraft(request) ? request : null
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
      if (typeof id !== 'string' || !isUuid(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const draft = isAssistantDraft(request) ? request : null
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
      if (typeof id !== 'string' || !isUuid(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await removeAssistantAndUnbind(service, options.conversations, id)
      return result.ok ? { ok: true, value: true } : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )
}

/** preload 侧实现必须满足的形状（编译期校验）。 */
export type { AssistantBridge }
