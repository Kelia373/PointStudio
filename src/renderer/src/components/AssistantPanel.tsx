// 助手管理面板：列出、改名/改提示词、删除。
//
// 此前只能新建与选择——写错一个字的提示词没法改，建错了没法删。
// 组件只做显示与转发，读写都在主进程。
//
// 两种宿主：抽屉（宽）与右侧检查器（窄，embedded）。后者不再自带「收起」，
// 顶部的返回交给检查器的 tab 行，避免一个面板里出现两个关闭入口。
import { useCallback, useEffect, useRef, useState } from 'react'

import ConfirmButton from './ConfirmButton'
import AgentAvatar from './AgentAvatar'
import { describeError } from '../../../shared/i18n/errors.ts'
import type { AssistantDto } from '../../../shared/types/ipc.ts'

export default function AssistantPanel({
  onClose,
  onChanged,
  focusAgentId = null,
  embedded = false
}: {
  onClose?: () => void
  /** 助手变动后通知父组件刷新下拉。 */
  onChanged: () => void
  /** 从右键菜单进来时，直接展开这个 Agent 的编辑区。 */
  focusAgentId?: string | null
  /** 嵌在右侧检查器里：纵向表单、无自带标题栏的收起键。 */
  embedded?: boolean
}) {
  const [assistants, setAssistants] = useState<AssistantDto[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  // 同一次「打开设置」只自动展开一次：保存后列表刷新不该把表单又弹回来
  const handledFocus = useRef<string | null>(null)

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

  // 从右键菜单进来：列表到了就直接进入这个 Agent 的编辑态
  useEffect(() => {
    if (!focusAgentId || handledFocus.current === focusAgentId) {
      return
    }
    const found = assistants.find((item) => item.id === focusAgentId)
    if (found) {
      handledFocus.current = focusAgentId
      startEdit(found)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAgentId, assistants])

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
    <div className={`assistants${embedded ? ' assistants--embedded' : ''}`}>
      <div className="assistants__head">
        <span className="assistants__title">
          智能体（{assistants.length}）
        </span>
        {onClose ? (
          <button className="assistants__close" type="button" onClick={onClose}>
            {embedded ? '返回上下文' : '收起'}
          </button>
        ) : null}
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
                  aria-label="智能体名称"
                  onChange={(event) => setName(event.target.value)}
                />
                <textarea
                  className="assistants__input assistants__input--wide"
                  value={systemPrompt}
                  placeholder="系统提示"
                  aria-label="系统提示词"
                  rows={embedded ? 5 : 3}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                />
                <div className="assistants__actions">
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
              </div>
            ) : (
              <>
                <AgentAvatar agentId={assistant.id} name={assistant.name} size={16} />
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
