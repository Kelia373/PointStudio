// 新建智能体：Orca 式紧凑单卡居中弹窗。
//
// 只负责收集输入与一次 IPC 调用；创建成功后把 AssistantDto 交给外壳去刷新与绑定。
import { useEffect, useMemo, useState } from 'react'

import { describeError } from '../../../shared/i18n/errors.ts'
import type {
  AgentPermissionMode,
  AssistantDto,
  ProviderSettingsViewDto
} from '../../../shared/types/ipc.ts'
import { AVATAR_KEYS, pickAgentAvatar, type AvatarKey } from '../lib/agentAvatar'
import { modelChoices } from '../lib/modelOptions'
import {
  PERMISSION_MODE_META,
  PERMISSION_MODE_ORDER,
  permissionModeMeta
} from '../lib/permissionModes'
import { AVATAR_SOURCES } from './AgentAvatar'
import Icon from './Icon'

const SOUL_MAX = 200
const NAME_MAX = 60

export default function AgentCreateDialog({
  provider,
  existingNames,
  onClose,
  onCreated
}: {
  provider: ProviderSettingsViewDto | null
  existingNames: string[]
  onClose: () => void
  onCreated: (assistant: AssistantDto) => void
}) {
  const [name, setName] = useState('')
  const [soul, setSoul] = useState('')
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>('smart')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [modelId, setModelId] = useState('')
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [modeOpen, setModeOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const models = useMemo(
    () => modelChoices(provider?.providerId ?? null, null),
    [provider?.providerId]
  )
  const previewKey = pickAgentAvatar('', name, avatar)
  const modeMeta = permissionModeMeta(permissionMode)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault()
        void submit()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, soul, permissionMode, avatar, modelId, busy])

  async function submit(): Promise<void> {
    if (busy) {
      return
    }
    const trimmed = name.trim()
    if (trimmed === '') {
      setError('请先给智能体起个名字')
      return
    }
    if (Array.from(trimmed).length > NAME_MAX) {
      setError(`名称最多 ${NAME_MAX} 个字`)
      return
    }
    if (existingNames.includes(trimmed)) {
      setError('已存在同名智能体')
      return
    }
    setBusy(true)
    const result = await window.pointstudio.assistants.create({
      name: trimmed,
      systemPrompt: soul,
      permissionMode,
      avatar,
      providerId: provider?.providerId ?? null,
      modelId: modelId === '' ? null : modelId
    })
    if (!result.ok) {
      setBusy(false)
      setError(describeError(result.code))
      return
    }
    onCreated(result.value)
  }

  return (
    <div className="agent-dialog-mask" role="presentation" onMouseDown={onClose}>
      <section
        className="agent-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="新建智能体"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="agent-dialog__head">
          <span className="agent-dialog__title">新建智能体</span>
          <button
            className="agent-dialog__close"
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            <Icon name="x" size={13} />
          </button>
        </header>

        <div className="agent-dialog__body">
          <div className="agent-dialog__identity">
            <button
              className="agent-dialog__avatar"
              type="button"
              aria-label="选择头像"
              title="选择头像"
              onClick={() => setAvatarOpen((value) => !value)}
            >
              <img src={AVATAR_SOURCES[previewKey]} alt="" width={48} height={48} />
              <span className="agent-dialog__avatar-edit">
                <Icon name="pen-line" size={10} />
              </span>
            </button>
            <input
              className="agent-dialog__name"
              value={name}
              autoFocus
              maxLength={NAME_MAX}
              placeholder="输入名称"
              aria-label="智能体名称"
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
            />
          </div>

          {avatarOpen ? (
            <div className="avatar-grid" role="listbox" aria-label="选择头像">
              <button
                className={`avatar-grid__item avatar-grid__item--auto${
                  avatar === null ? ' is-on' : ''
                }`}
                type="button"
                role="option"
                aria-selected={avatar === null}
                onClick={() => {
                  setAvatar(null)
                  setAvatarOpen(false)
                }}
              >
                自动匹配
              </button>
              {AVATAR_KEYS.map((key: AvatarKey) => (
                <button
                  key={key}
                  className={`avatar-grid__item${avatar === key ? ' is-on' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={avatar === key}
                  title={key}
                  onClick={() => {
                    setAvatar(key)
                    setAvatarOpen(false)
                  }}
                >
                  <img src={AVATAR_SOURCES[key]} alt="" width={28} height={28} />
                </button>
              ))}
            </div>
          ) : null}

          <label className="agent-dialog__field">
            <span className="agent-dialog__label">Soul</span>
            <textarea
              className="agent-dialog__soul"
              value={soul}
              maxLength={SOUL_MAX}
              rows={5}
              placeholder="它是谁，负责做什么"
              aria-label="Soul 系统提示词"
              onChange={(event) => setSoul(event.target.value)}
            />
            <span className="agent-dialog__counter">
              {Array.from(soul).length} / {SOUL_MAX}
            </span>
          </label>

          <div className="agent-dialog__row">
            <div className="agent-dialog__field agent-dialog__field--mode">
              <span className="agent-dialog__label">权限模式</span>
              <button
                className={`mode-picker mode-picker--${modeMeta.tone}${
                  modeOpen ? ' is-open' : ''
                }`}
                type="button"
                aria-expanded={modeOpen}
                aria-haspopup="listbox"
                onClick={() => setModeOpen((value) => !value)}
              >
                <span className="mode-picker__text">
                  <b>{modeMeta.label}</b>
                  <small>{modeMeta.description}</small>
                </span>
                {modeMeta.tone === 'warn' ? <span className="mode-badge">!</span> : null}
                {modeMeta.tone === 'danger' ? (
                  <span className="mode-badge mode-badge--danger">!</span>
                ) : null}
                <Icon name="arrow-down" size={12} />
              </button>
              {modeOpen ? (
                <ul className="mode-list" role="listbox" aria-label="权限模式">
                  {PERMISSION_MODE_ORDER.map((mode) => {
                    const meta = PERMISSION_MODE_META[mode]
                    return (
                      <li key={mode}>
                        <button
                          className={`mode-list__item mode-list__item--${meta.tone}${
                            permissionMode === mode ? ' is-on' : ''
                          }`}
                          type="button"
                          role="option"
                          aria-selected={permissionMode === mode}
                          onClick={() => {
                            setPermissionMode(mode)
                            setModeOpen(false)
                          }}
                        >
                          <span className="mode-list__text">
                            <b>{meta.label}</b>
                            <small>{meta.description}</small>
                          </span>
                          {meta.tone === 'warn' ? <span className="mode-badge">!</span> : null}
                          {meta.tone === 'danger' ? (
                            <span className="mode-badge mode-badge--danger">!</span>
                          ) : null}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              ) : null}
            </div>

            <label className="agent-dialog__field">
              <span className="agent-dialog__label">模型</span>
              <select
                className="agent-dialog__select"
                value={modelId}
                aria-label="模型"
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="">跟随全局默认</option>
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error ? <div className="agent-dialog__error">{error}</div> : null}
        </div>

        <footer className="agent-dialog__foot">
          <button className="agent-dialog__cancel" type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="agent-dialog__submit"
            type="button"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? '创建中…' : '创建'}
            <span className="agent-dialog__hint">Ctrl+↵</span>
          </button>
        </footer>
      </section>
    </div>
  )
}
