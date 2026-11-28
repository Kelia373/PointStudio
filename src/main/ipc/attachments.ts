// ipc/attachments —— 聊天附图的跨进程边界。
//
// 渲染层只递 data URL，主进程负责校验、落盘、回读；图片本体永远不进 messages.json。
import { clipboard, ipcMain } from 'electron'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { MAX_IMAGE_BYTES, type AttachmentService } from '../services/attachmentService.ts'

import {
  type ClipboardImageDraft,
  ATTACHMENT_CHANNELS,
  IMAGE_MIME_TYPES,
  type AttachmentsBridge,
  type IpcResult,
  type MessageImageDto
} from '../../shared/types/ipc.ts'

function isSaveRequest(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  if (typeof record['dataUrl'] !== 'string') {
    return false
  }
  // 先卡长度再解码：10MB 二进制约 13.4MB base64，留一点余量；
  // 否则超大字符串会先被 Buffer 全量分配再拒。
  if (record['dataUrl'].length > 14 * 1024 * 1024) {
    return false
  }
  return record['name'] === undefined || typeof record['name'] === 'string'
}

function isImageMime(value: string): boolean {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

/** 扩展名 → 白名单 MIME；不在表里的一律不碰（SVG 永远不在表里）。 */
const MIME_BY_EXT: Record<string, MessageImageDto['mimeType']> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
}

const CLIPBOARD_IMAGE_TYPES = IMAGE_MIME_TYPES

/**
 * Electron 45 的 clipboard 是 W3C 风格异步 API：`read()` 返回 ClipboardItem[]，
 * 每项按 MIME 取 Blob。截图工具的位图会作为 image/png 出现；资源管理器
 * Ctrl+C 复制文件则以 `text/uri-list`（file:// 列表）出现——两条都要管，
 * 因为渲染层 `clipboardData.items` 在这两种场景下都是空的。
 */
function filePathsFromUriList(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      try {
        const url = new URL(line)
        if (url.protocol !== 'file:') {
          return ''
        }
        // Windows: /C:/Users/... → C:/Users/...
        const path = decodeURIComponent(url.pathname)
        return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path
      } catch {
        return ''
      }
    })
    .filter((item) => item !== '')
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
  ipcMain.handle(
    ATTACHMENT_CHANNELS.pasteClipboard,
    async (_event, limitRaw: unknown): Promise<IpcResult<ClipboardImageDraft[]>> => {
      const limit =
        typeof limitRaw === 'number' && Number.isFinite(limitRaw)
          ? Math.max(1, Math.min(6, Math.floor(limitRaw)))
          : 6
      try {
        const items = await clipboard.read()
        const drafts: ClipboardImageDraft[] = []
        let uriList = ''

        for (const item of items) {
          if (drafts.length >= limit) {
            break
          }
          const imageType = (item.types ?? []).find((type) =>
            (CLIPBOARD_IMAGE_TYPES as readonly string[]).includes(type)
          )
          if (imageType !== undefined) {
            const blob = await item.getType(imageType)
            if (!(blob instanceof Blob)) {
              continue
            }
            const bytes = Buffer.from(await blob.arrayBuffer())
            const mimeType = imageType as MessageImageDto['mimeType']
            const saved = await options.attachments.saveBytes(bytes, mimeType, 'screenshot.png')
            if (saved.ok) {
              drafts.push({
                image: saved.value,
                previewUrl: `data:${mimeType};base64,${bytes.toString('base64')}`
              })
            }
            continue
          }
          if ((item.types ?? []).includes('text/uri-list')) {
            const blob = await item.getType('text/uri-list')
            if (blob instanceof Blob) {
              uriList = await blob.text()
            }
          }
        }

        // 资源管理器 Ctrl+C 复制的本地图片文件：只贴第一张，多选交给拖入。
        if (drafts.length === 0 && uriList !== '') {
          for (const file of filePathsFromUriList(uriList)) {
            const mime = MIME_BY_EXT[extname(file).toLowerCase()]
            if (mime === undefined) {
              continue
            }
            try {
              const info = await stat(file)
              if (!info.isFile() || info.size === 0 || info.size > MAX_IMAGE_BYTES) {
                continue
              }
              const bytes = await readFile(file)
              const saved = await options.attachments.saveBytes(bytes, mime, basename(file))
              if (saved.ok) {
                drafts.push({
                  image: saved.value,
                  previewUrl: `data:${mime};base64,${bytes.toString('base64')}`
                })
                break
              }
            } catch {
              continue
            }
          }
        }

        return { ok: true, value: drafts }
      } catch {
        // 读剪贴板失败要说出来：静默返回空数组时用户只会觉得「按了没反应」。
        return { ok: false, code: 'E_IMAGE_UNREADABLE' }
      }
    }
  )
}

/** 编译期校验：preload 的实现在这里对齐形状。 */
export type { AttachmentsBridge }
export { isImageMime }
