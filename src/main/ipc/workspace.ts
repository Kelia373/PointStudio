// ipc/workspace —— 工作区文件的跨进程边界。
//
// 渲染进程只能给一个绝对路径（拖拽拿到的），读源、落盘、登记都在主进程做：
// 界面永远不直接碰文件系统。
import { BrowserWindow, dialog, ipcMain } from 'electron'

import {
  WORKSPACE_CHANNELS,
  type IpcResult,
  type WorkspaceFileDto
} from '../../shared/types/ipc.ts'
import type { WorkspaceFile } from '../ai/domain/workspace.ts'
import type { WorkspaceImportService } from '../services/workspaceImportService.ts'
import type { WorkspaceService } from '../services/workspaceService.ts'
import { isUuid, isWorkspaceImportPath } from './validators.ts'
import { DEFAULT_CHUNK_CHARS } from '../ai/domain/chunking.ts'
import { locateChunk, parseChunkId } from '../services/chunkLocator.ts'

function toDto(file: WorkspaceFile): WorkspaceFileDto {
  return {
    id: file.id,
    path: file.path,
    sizeBytes: file.sizeBytes,
    importedAt: file.importedAt
  }
}

export interface WorkspaceIpcOptions {
  workspace: WorkspaceService
  importer: WorkspaceImportService
  /** 读取工作区内文件内容（由组合根绑定 fs）。 */
  readStoredFile: (relativePath: string) => Promise<string>
}

export function registerWorkspaceIpc(options: WorkspaceIpcOptions): void {
  ipcMain.handle(WORKSPACE_CHANNELS.list, async (): Promise<WorkspaceFileDto[]> => {
    const items = await options.workspace.list()
    return items.map(toDto)
  })

  ipcMain.handle(
    WORKSPACE_CHANNELS.import,
    async (_event, absolutePath: unknown): Promise<IpcResult<WorkspaceFileDto>> => {
      if (!isWorkspaceImportPath(absolutePath)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await options.importer.importFromPath(absolutePath)
      return result.ok
        ? { ok: true, value: toDto(result.value) }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    WORKSPACE_CHANNELS.pickAndImport,
    async (event): Promise<IpcResult<WorkspaceFileDto>> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options_ = { title: '导入到工作区', properties: ['openFile' as const] }
      const picked = window
        ? await dialog.showOpenDialog(window, options_)
        : await dialog.showOpenDialog(options_)
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false, code: 'E_CANCELLED' }
      }
      const result = await options.importer.importFromPath(picked.filePaths[0])
      return result.ok
        ? { ok: true, value: toDto(result.value) }
        : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    WORKSPACE_CHANNELS.readChunk,
    async (
      _event,
      chunkId: unknown
    ): Promise<IpcResult<{ path: string; index: number; text: string }>> => {
      if (typeof chunkId !== 'string' || chunkId.length > 512) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const parsed = parseChunkId(chunkId)
      if (!parsed) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }

      let content: string
      try {
        content = await options.readStoredFile(parsed.path)
      } catch {
        return { ok: false, code: 'E_SOURCE_UNREADABLE' }
      }

      const located = locateChunk(content, parsed.index, DEFAULT_CHUNK_CHARS)
      if (!located) {
        // 文件被改过、块数变少——不猜相近的块，直接说找不到了。
        return { ok: false, code: 'E_NOT_FOUND' }
      }
      return { ok: true, value: { path: parsed.path, index: parsed.index, text: located.text } }
    }
  )

  ipcMain.handle(
    WORKSPACE_CHANNELS.remove,
    async (_event, id: unknown): Promise<IpcResult<true>> => {
      if (typeof id !== 'string' || !isUuid(id)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await options.importer.remove(id)
      return result.ok ? { ok: true, value: true } : { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
    }
  )
}
