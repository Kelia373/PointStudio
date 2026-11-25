// 助手管理面板：列出、改名/改提示词、删除。
//
// 此前只能新建与选择——写错一个字的提示词没法改，建错了没法删。
// 组件只做显示与转发，读写都在主进程。
import { useCallback, useEffect, useState } from 'react'

import ConfirmButton from './ConfirmButton'
import { describeError } from '../../../shared/i18n/errors.ts'
import type { AssistantDto } from '../../../shared/types/ipc.ts'

export default function AssistantPanel({
  onClose,
  onChanged
}: {
  onClose: () => void
  /** 助手变动后通知父组件刷新下拉。 */
  onChanged: () => void
}) {
  const [assistants, setAssistants] = useState<AssistantDto[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    setAssistants(await window.pointstudio.assistants.list())
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  function startEdit(assistant: AssistantDto): void {
    setEditingId(assistant.id)
    setName(assistant.name)
    setSystemPrompt(assistant.systemPrompt)
    setMessage(null)
  }

  async function save(): Promise<void> {
    if (!editingId) {
      return
    }
    const result = await window.pointstudio.assistants.update(editingId, {
      name,
      systemPrompt
    })
    if (!result.ok) {
      setMessage(describeError(result.code))
      return
    }
    setEditingId(null)
    setMessage('已保存')
    await reload()
    onChanged()
  }

  async function remove(id: string): Promise<void> {
    const result = await window.pointstudio.assistants.remove(id)
    if (!result.ok) {
      setMessage(describeError(result.code))
      return
    }
    setMessage('已删除，引用它的会话已解绑')
    await reload()
    onChanged()
  }

  return (
    <div className="assistants">
      <div className="assistants__head">
        <span className="assistants__title">助手（{assistants.length}）</span>
        <button className="assistants__close" type="button" onClick={onClose}>
          收起
        </button>
      </div>

      {message ? <div className="assistants__message">{message}</div> : null}

      <ul className="assistants__list">
        {assistants.map((assistant) => (
          <li key={assistant.id} className="assistants__item">
            {editingId === assistant.id ? (
              <div className="assistants__form">
                <input
                  className="assistants__input"
                  value={name}
                  placeholder="名称"
                  onChange={(event) => setName(event.target.value)}
                />
                <input
                  className="assistants__input assistants__input--wide"
                  value={systemPrompt}
                  placeholder="系统提示"
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
                <button className="assistants__save" type="button" onClick={() => void save()}>
                  保存
                </button>
                <button
                  className="assistants__cancel"
                  type="button"
                  onClick={() => setEditingId(null)}
                >
                  取消
                </button>
              </div>
            ) : (
              <>
                <span className="assistants__name" title={assistant.systemPrompt}>
                  {assistant.name}
                </span>
                <button
                  className="assistants__edit"
                  type="button"
                  onClick={() => startEdit(assistant)}
                >
                  编辑
                </button>
                <ConfirmButton
                  className="assistants__remove"
                  ariaLabel="删除助手"
                  title="删除助手"
                  confirmLabel="删?"
                  onConfirm={() => void remove(assistant.id)}
                />
              </>
            )}
          </li>
        ))}
        {assistants.length === 0 ? (
          <li className="assistants__empty">还没有助手。用顶部「＋助手」建一个。</li>
        ) : null}
      </ul>
    </div>
  )
}
