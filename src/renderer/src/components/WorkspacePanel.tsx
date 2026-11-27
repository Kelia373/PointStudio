// 工作区面板（最小可用版）：列出已导入文件、导入、删除。
//
// 样式是占位的，等设计稿整体换皮。组件只做显示与转发事件，
// 读源 / 落盘 / 登记全在主进程，界面不碰文件系统。
import { useCallback, useEffect, useState } from 'react'

import ConfirmButton from './ConfirmButton'
import { describeError } from '../../../shared/i18n/errors.ts'
import type { WorkspaceFileDto } from '../../../shared/types/ipc.ts'
import { formatBytes } from '../../../shared/utils/format.ts'

export default function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const [files, setFiles] = useState<WorkspaceFileDto[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setFiles(await window.pointstudio.workspace.list())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  async function pickAndImport(): Promise<void> {
    const result = await window.pointstudio.workspace.pickAndImport()
    if (!result.ok) {
      setMessage(describeError(result.code))
      return
    }
    setMessage(`已导入 ${result.value.path}`)
    await reload()
  }

  async function remove(id: string): Promise<void> {
    const result = await window.pointstudio.workspace.remove(id)
    if (!result.ok) {
      setMessage(describeError(result.code))
      return
    }
    setMessage(null)
    await reload()
  }

  return (
    <div className="workspace">
      <div className="workspace__head">
        <span className="workspace__title">工作区（{files.length}）</span>
        <button className="workspace__import" type="button" onClick={() => void pickAndImport()}>
          导入文件
        </button>
        <button className="workspace__close" type="button" onClick={onClose}>
          收起
        </button>
      </div>

      {message ? <div className="workspace__message">{message}</div> : null}

      <ul className="workspace__list">
        {files.map((file) => (
          <li key={file.id} className="workspace__item">
            <span className="workspace__name" title={file.path}>
              {file.path}
            </span>
            <span className="workspace__size">{formatBytes(file.sizeBytes)}</span>
            <ConfirmButton
              className="workspace__remove"
              ariaLabel="移除文件"
              title="移除文件"
              confirmLabel="移除?"
              onConfirm={() => void remove(file.id)}
            />
          </li>
        ))}
        {files.length === 0 ? (
          <li className="workspace__empty">
            还没有文件。导入后，提问时会在这些文件里检索并把来源带进回答。
          </li>
        ) : null}
      </ul>
    </div>
  )
}
