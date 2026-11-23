// ipc/backup —— 整库备份的跨进程边界。
//
// 导出给文本（界面决定复制还是存盘）；导入走系统文件选择框，
// 读文件与恢复都在主进程完成——渲染进程不碰文件系统。
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'

import {
  BACKUP_CHANNELS,
  type IpcResult,
  type RestoreCountsDto,
  type RestoreModeDto
} from '../../shared/types/ipc.ts'
import type { BackupService } from '../services/backupService.ts'

const MAX_BACKUP_BYTES = 50 * 1024 * 1024

function isRestoreMode(value: unknown): value is RestoreModeDto {
  return value === 'replace' || value === 'merge'
}

export interface BackupIpcOptions {
  backup: BackupService
}

export function registerBackupIpc(options: BackupIpcOptions): void {
  ipcMain.handle(BACKUP_CHANNELS.exportText, async (): Promise<IpcResult<string>> => {
    const text = await options.backup.exportToText()
    return { ok: true, value: text }
  })

  ipcMain.handle(
    BACKUP_CHANNELS.importFile,
    async (event, mode: unknown): Promise<IpcResult<RestoreCountsDto | true>> => {
      if (!isRestoreMode(mode)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }

      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        title: '选择 PointStudio 备份文件',
        properties: ['openFile' as const],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }
      const picked = window
        ? await dialog.showOpenDialog(window, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      if (picked.canceled || picked.filePaths.length === 0) {
        return { ok: false, code: 'E_CANCELLED' }
      }

      let text: string
      try {
        text = await readFile(picked.filePaths[0], 'utf8')
      } catch {
        return { ok: false, code: 'E_SOURCE_UNREADABLE' }
      }
      if (text.length > MAX_BACKUP_BYTES) {
        return { ok: false, code: 'E_FILE_TOO_LARGE' }
      }

      const result = await options.backup.restore(text, mode)
      if (!result.ok) {
        return { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
      }
      return { ok: true, value: result.value === true ? true : result.value }
    }
  )
}
