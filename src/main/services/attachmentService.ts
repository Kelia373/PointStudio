// services/attachmentService —— 聊天附图的独立落盘与回收。
//
// 为什么必须单独存：base64 塞进 messages.json 会让「读一条消息」变成「读全部
// 图片」，历史的每次写盘都要重写几 MB。这里只写文件，消息里只留元数据。
//
// 安全边界：MIME 白名单、单张上限、UUID 校验（挡目录穿越）、文件名只取 basename。
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  IMAGE_MIME_TYPES,
  type ImageMimeTypeDto,
  type MessageImageDto,
  type SaveAttachmentRequest
} from '../../shared/types/ipc.ts'
import { isUuid } from '../utils/uuid.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

/** 单张图片上限：10 MB。再大就不是「贴张截图」而是传素材了。 */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export interface AttachmentServiceDeps {
  newId: () => string
}

const EXT_BY_MIME: Record<ImageMimeTypeDto, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

const MIME_BY_EXT: Record<string, ImageMimeTypeDto> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

const DATA_URL = /^data:(image\/[a-z+]+);base64,([\s\S]+)$/i

function isAllowedMime(value: string): value is ImageMimeTypeDto {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

/** 文件名只留最后一段并去掉控制字符：用户传什么名字进来都写不到目录外去。 */
function safeName(raw: string | undefined): string {
  const base = (raw ?? '').replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '').trim()
  return cleaned === '' ? 'image' : cleaned.slice(0, 120)
}

function decodeBase64(payload: string): Buffer | null {
  const compact = payload.replace(/\s+/g, '')
  if (compact === '' || /[^A-Za-z0-9+/=]/.test(compact)) {
    return null
  }
  const buffer = Buffer.from(compact, 'base64')
  return buffer.length === 0 ? null : buffer
}

export class AttachmentService {
  private readonly dir: string
  private readonly deps: AttachmentServiceDeps

  constructor(dir: string, deps: AttachmentServiceDeps) {
    this.dir = dir
    this.deps = deps
  }

  pathFor(id: string, mimeType: ImageMimeTypeDto): string {
    return join(this.dir, `${id}.${EXT_BY_MIME[mimeType]}`)
  }

  async save(request: SaveAttachmentRequest): Promise<ServiceResult<MessageImageDto>> {
    const dataUrl = typeof request?.dataUrl === 'string' ? request.dataUrl.trim() : ''
    const matched = DATA_URL.exec(dataUrl)
    if (matched === null) {
      return { ok: false, errors: ['E_IMAGE_INVALID'] }
    }
    const mimeType = matched[1].toLowerCase()
    if (!isAllowedMime(mimeType)) {
      // gif/jpeg 之外的 image/svg+xml 之类一律拒收：SVG 能带脚本。
      return { ok: false, errors: ['E_IMAGE_TYPE'] }
    }
    const bytes = decodeBase64(matched[2])
    if (bytes === null) {
      return { ok: false, errors: ['E_IMAGE_INVALID'] }
    }
    if (bytes.length > MAX_IMAGE_BYTES) {
      return { ok: false, errors: ['E_IMAGE_TOO_LARGE'] }
    }

    const id = this.deps.newId()
    await mkdir(this.dir, { recursive: true })
    await writeFile(this.pathFor(id, mimeType), bytes)

    return {
      ok: true,
      value: {
        id,
        mimeType,
        name: safeName(request?.name),
        sizeBytes: bytes.length
      }
    }
  }

  /** 图元数据 → data URL（渲染层 <img src> 直接用）。 */
  async readDataUrl(id: string): Promise<ServiceResult<string>> {
    const found = await this.locate(id)
    if (!found.ok) {
      return found
    }
    const bytes = await readFile(found.value.path)
    return { ok: true, value: `data:${found.value.mimeType};base64,${bytes.toString('base64')}` }
  }

  /** 图元数据 → 纯 base64（三套模型协议都要这个形状）。 */
  async readBase64(id: string): Promise<ServiceResult<{ base64: string; mimeType: ImageMimeTypeDto }>> {
    const found = await this.locate(id)
    if (!found.ok) {
      return found
    }
    const bytes = await readFile(found.value.path)
    return { ok: true, value: { base64: bytes.toString('base64'), mimeType: found.value.mimeType } }
  }

  /**
   * 回收孤儿图片。
   *
   * `referencedIds` 必须是**全库**剩余消息里出现过的 id：分叉（branch）会共享历史
   * 图片，只按单会话算引用就会把别的会话还在用的图删掉。
   */
  async pruneUnreferenced(
    referencedIds: ReadonlySet<string>
  ): Promise<{ removed: number }> {
    let names: string[]
    try {
      names = await readdir(this.dir)
    } catch {
      return { removed: 0 }
    }

    let removed = 0
    for (const name of names) {
      const match = /^([0-9a-f-]{36})\.(png|jpg|webp|gif)$/i.exec(name)
      if (match === null || referencedIds.has(match[1])) {
        continue
      }
      try {
        await unlink(join(this.dir, name))
        removed += 1
      } catch {
        // 已被别的路径删掉：目标达成，不算失败。
      }
    }
    return { removed }
  }

  private async locate(
    id: string
  ): Promise<ServiceResult<{ path: string; mimeType: ImageMimeTypeDto }>> {
    if (!isUuid(id)) {
      return { ok: false, errors: ['E_BAD_INPUT'] }
    }
    for (const [ext, mimeType] of Object.entries(MIME_BY_EXT)) {
      const path = join(this.dir, `${id}.${ext}`)
      try {
        await readFile(path)
        return { ok: true, value: { path, mimeType } }
      } catch {
        continue
      }
    }
    return { ok: false, errors: ['E_NOT_FOUND'] }
  }
}
