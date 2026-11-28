// ipc/attachments —— 聊天附图的跨进程边界。
//
// 渲染层只递 data URL，主进程负责校验、落盘、回读；图片本体永远不进 messages.json。
import { ipcMain } from 'electron'

import {
  ATTACHMENT_CHANNELS,
  IMAGE_MIME_TYPES,
  type AttachmentsBridge,
  type IpcResult,
  type MessageImageDto
} from '../../shared/types/ipc.ts'
import type { AttachmentService } from '../services/attachmentService.ts'

function isSaveRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  if (typeof record['dataUrl'] !== 'string') {
    return false
  }
  return record['name'] === undefined || typeof record['name'] === 'string'
}

function isImageMime(value: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

export interface AttachmentsIpcOptions {
  attachments: AttachmentService
}

export function registerAttachmentsIpc(options: AttachmentsIpcOptions): void {
  ipcMain.handle(
    ATTACHMENT_CHANNELS.save,
    async (_event, request: unknown): Promise<IpcResult<MessageImageDto>> => {
      if (!isSaveRequest(request)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await options.attachments.save(
        request as { dataUrl: string; name?: string }
      )
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    ATTACHMENT_CHANNELS.readDataUrl,
    async (_event, id: unknown): Promise<IpcResult<string>> => {
      if (typeof id !== 'string') {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await options.attachments.readDataUrl(id)
      return result.ok
        ? { ok: true, value: result.value }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )
}

/** 编译期校验：preload 的实现在这里对齐形状。 */
export type { AttachmentsBridge }
export { isImageMime }
