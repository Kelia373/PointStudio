// services/workspaceService —— 工作区文件的登记与移除。
//
// 只登记「工作区里有哪些文件、多大、什么时候进来的」。文件内容由外壳负责
// 落盘（本层拿到的是已读好的 content），因此这一层不 import fs，可单测。
import {
  validateImportRequest,
  type ImportRequest,
  type WorkspaceFile
} from '../ai/domain/workspace.ts'
import type { JsonFileStore } from '../data/fileStore.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface WorkspaceServiceDeps {
  newId: () => string
  now: () => string
}

export class WorkspaceService {
  private readonly store: JsonFileStore<WorkspaceFile>
  private readonly deps: WorkspaceServiceDeps

  constructor(store: JsonFileStore<WorkspaceFile>, deps: WorkspaceServiceDeps) {
    this.store = store
    this.deps = deps
  }

  async list(): Promise<WorkspaceFile[]> {
    const items = await this.store.readAll()
    return [...items].sort((a, b) => a.path.localeCompare(b.path))
  }

  async get(id: string): Promise<WorkspaceFile | null> {
    const items = await this.store.readAll()
    return items.find((item) => item.id === id) ?? null
  }

  async import(request: ImportRequest): Promise<ServiceResult<WorkspaceFile>> {
    const checked = validateImportRequest(request)
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    const items = await this.store.readAll()
    // 同路径不静默覆盖：那会让「我明明导入过」变成一句空话。
    if (items.some((item) => item.path === checked.value.path)) {
      return { ok: false, errors: ['E_FILE_EXISTS'] }
    }

    const file: WorkspaceFile = {
      id: this.deps.newId(),
      path: checked.value.path,
      sizeBytes: checked.value.sizeBytes,
      importedAt: this.deps.now()
    }
    items.push(file)
    await this.store.writeAll(items)
    return { ok: true, value: file }
  }

  async remove(id: string): Promise<ServiceResult<true>> {
    const items = await this.store.readAll()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }
    items.splice(index, 1)
    await this.store.writeAll(items)
    return { ok: true, value: true }
  }
}
