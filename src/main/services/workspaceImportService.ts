// services/workspaceImportService —— 从任意路径把文件导入工作区。
//
// 三件事的顺序很讲究：**读源 → 校验 → 落盘 → 登记**。
// - 先读再判，避免"没读到就登记"；
// - 落盘失败要回滚登记，否则列表里有文件、磁盘上没有；
// - 同名直接拒绝，绝不覆盖用户已有文件。
//
// 本层不 import fs：读写通过注入的端口完成，因此可脱离运行环境单测。
import { validateImportRequest, type WorkspaceFile } from '../ai/domain/workspace.ts'
import type { WorkspaceService } from './workspaceService.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface WorkspaceImportPorts {
  /** 读取源文件内容（绝对路径）。 */
  readSource: (absolutePath: string) => Promise<string>
  /** 把内容写到工作区存储（相对路径）。 */
  writeStored: (relativePath: string, content: string) => Promise<void>
  /** 删掉工作区存储里的副本；文件本就不在时按成功处理。 */
  removeStored: (relativePath: string) => Promise<void>
}

/** 只保留文件名：工作区是一层平面命名空间，保留原目录结构只会制造歧义。 */
export function toWorkspacePath(absolutePath: string): string {
  const normalized = absolutePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter((segment) => segment !== '')
  return segments[segments.length - 1] ?? ''
}

export class WorkspaceImportService {
  private readonly workspace: WorkspaceService
  private readonly ports: WorkspaceImportPorts

  constructor(workspace: WorkspaceService, ports: WorkspaceImportPorts) {
    this.workspace = workspace
    this.ports = ports
  }

  async importFromPath(absolutePath: string): Promise<ServiceResult<WorkspaceFile>> {
    const path = toWorkspacePath(absolutePath)
    if (path === '') {
      return { ok: false, errors: ['E_PATH_UNSAFE'] }
    }

    let content: string
    try {
      content = await this.ports.readSource(absolutePath)
    } catch {
      return { ok: false, errors: ['E_SOURCE_UNREADABLE'] }
    }

    // 复用领域校验：空文件、超大、路径安全都在那里判。
    const checked = validateImportRequest({ path, content })
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    // 先查重再落盘：宁可在写之前拒绝，也不要覆盖已有内容。
    const existing = await this.workspace.list()
    if (existing.some((file) => file.path === checked.value.path)) {
      return { ok: false, errors: ['E_FILE_EXISTS'] }
    }

    try {
      await this.ports.writeStored(checked.value.path, content)
    } catch {
      return { ok: false, errors: ['E_WRITE_FAILED'] }
    }

    const registered = await this.workspace.import({ path: checked.value.path, content })
    if (!registered.ok) {
      // 登记失败（例如并发同名）：把刚落盘的文件清掉由调用方按需处理，
      // 这里至少保证「没有半套登记」。
      return { ok: false, errors: registered.errors }
    }
    return { ok: true, value: registered.value }
  }

  /**
   * 从工作区移除：**先撤登记，再删磁盘副本**。
   *
   * 顺序不能反——先删内容再撤登记的话，中途失败会让列表里留一条
   * 「点开读不到」的死记录；反过来最多留一份没人引用的副本（下次
   * 同名导入会被 E_FILE_EXISTS 挡住，但那也比半套状态好收拾）。
   * 删副本失败不再对用户报错：登记已经撤掉，用户看到的就是「已移除」。
   */
  async remove(id: string): Promise<ServiceResult<true>> {
    const file = await this.workspace.get(id)
    if (file === null) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    const removed = await this.workspace.remove(id)
    if (!removed.ok) {
      return removed
    }

    try {
      await this.ports.removeStored(file.path)
    } catch {
      // 副本没删掉只浪费磁盘，不能因此把「移除」判成失败。
    }
    return { ok: true, value: true }
  }
}
