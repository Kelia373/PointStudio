// ai/domain/workspace —— 工作区文件的模型与校验。
//
// 工作区是「任务的上下文资源」：文件登记进来后，任何会话都能引用它。
// 与附件不同——附件跟着一条消息走，工作区文件跟着工作台走。
import { isSafeRelativePath, normalizeRelativePath } from '../../utils/paths.ts'

export interface WorkspaceFile {
  id: string
  /** 归一化后的工作区内相对路径。 */
  path: string
  sizeBytes: number
  importedAt: string
}

export interface ImportRequest {
  path: string
  content: string
}

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

/** 单文件上限 5 MB：再大就不该塞进上下文窗口，应该走检索。 */
export const MAX_FILE_BYTES = 5_000_000

const encoder = new TextEncoder()

export function byteLength(text: string): number {
  return encoder.encode(text).length
}

export function validateImportRequest(request: ImportRequest): Validation<{
  path: string
  sizeBytes: number
}> {
  const errors: string[] = []
  const rawPath = (request.path ?? '').trim()

  if (!isSafeRelativePath(rawPath)) {
    errors.push('E_PATH_UNSAFE')
  }

  const content = request.content ?? ''
  if (content === '') {
    errors.push('E_FILE_EMPTY')
  }

  const sizeBytes = byteLength(content)
  if (sizeBytes > MAX_FILE_BYTES) {
    errors.push('E_FILE_TOO_LARGE')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, value: { path: normalizeRelativePath(rawPath), sizeBytes } }
}
