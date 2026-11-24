// ipc/clipboard —— 把文本写进系统剪贴板。
//
// 为什么不让渲染进程自己做：`navigator.clipboard` 依赖权限与用户手势，在
// 某些环境下是「永不 resolve」而不是报错，界面会卡在「复制中」。Electron 主进程
// 的 clipboard 没有这些约束，一次 IPC 换掉一整类偶发问题。
import { clipboard, ipcMain } from 'electron'

import { CLIPBOARD_CHANNELS } from '../../shared/types/ipc.ts'

/** 单次复制的上限：防止把整个数据库塞进剪贴板。 */
const MAX_TEXT_LENGTH = 5_000_000

export function registerClipboardIpc(): void {
  ipcMain.handle(CLIPBOARD_CHANNELS.writeText, (_event, text: unknown): boolean => {
    if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) {
      return false
    }
    clipboard.writeText(text)
    return true
  })
}
