// 助手管理面板：列出、改名/改提示词、删除。
//
// 此前只能新建与选择——写错一个字的提示词没法改，建错了没法删。
// 组件只做显示与转发，读写都在主进程。
//
// 两种宿主：抽屉（宽）与右侧检查器（窄，embedded）。后者不再自带「收起」，
// 顶部的返回交给检查器的 tab 行，避免一个面板里出现两个关闭入口。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import ConfirmButton from './ConfirmButton'
import AgentAvatar from './AgentAvatar'
import { describeError } from '../../../shared/i18n/errors.ts'
import type {
  AgentPermissionMode,
  AssistantDto,
  ProviderAccountViewDto,
  ReasoningEffortDto
} from '../../../shared/types/ipc.ts'
import { AVATAR_KEYS } from '../lib/agentAvatar'
import ModelPickerPopover from './ModelPickerPopover'
import {
  MODEL_SERVICES_KEY,
  parseModelServicesState
} from '../lib/modelServices'
import {
  PERMISSION_MODE_ORDER,
  permissionModeMeta
} from '../lib/permissionModes'

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
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>('smart')
  const [avatar, setAvatar] = useState('')
  const [picked, setPicked] = useState<{
    providerId: string | null
    modelId: string | null
    effort: ReasoningEffortDto | null
  }>({ providerId: null, modelId: null, effort: null })
  const [accounts, setAccounts] = useState<ProviderAccountViewDto[]>([])
  const services = useMemo(
    () => parseModelServicesState(window.localStorage.getItem(MODEL_SERVICES_KEY)),
    []
  )
  const [message, setMessage] = useState<string | null>(null)
  // 同一次「打开设置」只自动展开一次：保存后列表刷新不该把表单又弹回来
  const handledFocus = useRef<string | null>(null)

  const reload = useCallback(async (): Promise<void> => {
    const [list, accountList] = await Promise.all([
      window.pointstudio.assistants.list(),
      window.pointstudio.providers.listAccounts()
    ])
    setAssistants(list)
    setAccounts(accountList)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  function startEdit(assistant: AssistantDto): void {
    setEditingId(assistant.id)
    setName(assistant.name)
    setSystemPrompt(assistant.systemPrompt)
    setPermissionMode((assistant.permissionMode ?? 'smart') as AgentPermissionMode)
    setAvatar(assistant.avatar ?? '')
    setPicked({
      providerId: assistant.providerId,
      modelId: assistant.modelId,
      effort: assistant.params.effort ?? null
    })
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
    const current = assistants.find((item) => item.id === editingId)
    if (!current) {
      return
    }
    const result = await window.pointstudio.assistants.update(editingId, {
      name,
      systemPrompt,
      // update 是整条替换：未改动的字段必须原样带回，否则保存一次就洗掉参数
      providerId: picked.providerId,
      modelId: picked.modelId,
      params: { ...current.params, effort: picked.effort },
      enabled: current.enabled ?? true,
      permissionMode,
      avatar: avatar === '' ? null : avatar
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
                <label className="assistants__field">
                  <span className="assistants__field-label">权限模式</span>
                  <select
                    className="assistants__input"
                    value={permissionMode}
                    aria-label="权限模式"
                    onChange={(event) =>
                      setPermissionMode(event.target.value as AgentPermissionMode)
                    }
                  >
                    {PERMISSION_MODE_ORDER.map((mode) => (
                      <option key={mode} value={mode}>
                        {permissionModeMeta(mode).label}
                      </option>
                    ))}
                    {!PERMISSION_MODE_ORDER.includes(permissionMode) ? (
                      <option value={permissionMode}>
                        {permissionModeMeta(permissionMode).label}（历史值）
                      </option>
                    ) : null}
                  </select>
                </label>
                <label className="assistants__field">
                  <span className="assistants__field-label">模型</span>
                  <ModelPickerPopover
                    services={services}
                    accounts={accounts}
                    providerId={picked.providerId}
                    modelId={picked.modelId}
                    effort={picked.effort}
                    allowDefault
                    onChange={setPicked}
                  />
                </label>
                <label className="assistants__field">
                  <span className="assistants__field-label">头像</span>
                  <select
                    className="assistants__input"
                    value={avatar}
                    aria-label="头像"
                    onChange={(event) => setAvatar(event.target.value)}
                  >
                    <option value="">自动匹配</option>
                    {AVATAR_KEYS.map((key) => (
                      <option key={key} value={key}>
                        {key}
                      </option>
                    ))}
                  </select>
                </label>
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
                <AgentAvatar agentId={assistant.id} name={assistant.name} avatar={assistant.avatar} size={16} />
                <span className="assistants__name" title={assistant.systemPrompt}>
                  {assistant.name}
                  {assistant.builtin === true ? <em className="assistants__builtin">默认</em> : null}
                </span>
                <button
                  className="assistants__edit"
                  type="button"
                  onClick={() => startEdit(assistant)}
                >
                  编辑
                </button>
                {assistant.builtin === true ? (
                  <span className="assistants__protected" title="系统内置通用助手不可删除">
                    内置
                  </span>
                ) : (
                  <ConfirmButton
                    className="assistants__remove"
                    ariaLabel="删除助手"
                    title="删除助手"
                    confirmLabel="删?"
                    onConfirm={() => void remove(assistant.id)}
                  />
                )}
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
