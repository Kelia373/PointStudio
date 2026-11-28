// 通用模型选择浮层：来源图标轨 + 搜索 / 刷新 + 定高模型列表 + 动态思考强度。
//
// 三处共用：Agent 新建弹窗、检查器里的 Agent 编辑、普通自由对话输入栏。
// 小组 / 已绑定 Agent 的会话不允许在聊天里切换，由 Composer 负责锁成徽标。
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  ModelCapabilitiesDto,
  ProviderAccountViewDto,
  ReasoningEffortDto
} from '../../../shared/types/ipc.ts'
import { describeError } from '../../../shared/i18n/errors.ts'
import {
  MODEL_SERVICES_KEY,
  providerDisplayName,
  serializeModelServicesState,
  type ModelServicesState
} from '../lib/modelServices'
import {
  EFFORT_DISPLAY_ORDER,
  EFFORT_SHORT_LABEL,
  filterPickerModels,
  mergeDiscoveredIntoServices,
  resolvePickerModelCapabilities,
  sortPickerProviders,
  type PickerModel
} from '../lib/modelPicker'
import Icon from './Icon'
import ProviderLogo from './ProviderLogo'

export interface ModelPickerSelection {
  providerId: string | null
  modelId: string | null
  effort: ReasoningEffortDto | null
}

export interface ModelPickerPopoverProps {
  services: ModelServicesState
  accounts: ProviderAccountViewDto[]
  providerId: string | null
  modelId: string | null
  effort: ReasoningEffortDto | null
  /** 是否提供「跟随全局默认」（Agent 弹窗用）。 */
  allowDefault?: boolean
  /** 输入栏最上面的合成选项（如 Auto 协同路由）。 */
  topOption?: { value: string; label: string }

  /** 触发按钮高度：对话输入栏更紧凑。 */
  compact?: boolean
  onChange(selection: ModelPickerSelection): void
  /** 拉取模型后目录变了；不传则组件自行写回 localStorage。 */
  onServicesChanged?: (next: ModelServicesState) => void
  /** 未配通来源的「前往设置」回调。 */
  onOpenSettings?: (providerId: string) => void
}

function effortLabel(effort: ReasoningEffortDto | null): string {
  return effort === null ? '默认' : EFFORT_SHORT_LABEL[effort]
}

export default function ModelPickerPopover({
  services,
  accounts,
  providerId,
  modelId,
  effort,
  allowDefault = false,
  topOption,
  compact = false,
  onChange,
  onServicesChanged,
  onOpenSettings
}: ModelPickerPopoverProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeProviderId, setActiveProviderId] = useState(providerId)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // 刷新后父组件不一定立刻重渲染：这里留一份本地副本，保证列表即时更新。
  const [localServices, setLocalServices] = useState<ModelServicesState | null>(null)
  const effectiveServices = localServices ?? services
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(
    null
  )
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLocalServices(null)
  }, [services])

  const providers = useMemo(
    () => sortPickerProviders(effectiveServices, accounts),
    [effectiveServices, accounts]
  )
  const active =
    providers.find((item) => item.providerId === activeProviderId) ?? providers[0] ?? null

  useEffect(() => {
    setActiveProviderId(providerId)
  }, [providerId])

  useEffect(() => {
    if (!open) {
      return
    }
    const close = (event: MouseEvent): void => {
      const target = event.target as Node
      if (
        !panelRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  function toggle(): void {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const width = Math.max(300, rect.width)
      setPosition({
        left: Math.min(rect.left, window.innerWidth - width - 12),
        top: rect.bottom + 6,
        width
      })
    }
    setMessage(null)
    setOpen((value) => !value)
  }

  function commit(next: ModelPickerSelection): void {
    onChange(next)
    setOpen(false)
  }

  function capabilitiesFor(providerIdValue: string, modelIdValue: string): ModelCapabilitiesDto {
    return resolvePickerModelCapabilities(effectiveServices, providerIdValue, modelIdValue)
  }

  async function refresh(): Promise<void> {
    if (!active || !active.ready || !active.supported) {
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.pointstudio.providers.fetchModels(active.providerId)
      if (!result.ok) {
        setMessage(describeError(result.code))
        return
      }
      const next = mergeDiscoveredIntoServices(
        effectiveServices,
        active.providerId,
        result.value.models
      )
      window.localStorage.setItem(MODEL_SERVICES_KEY, serializeModelServicesState(next))
      setLocalServices(next)
      onServicesChanged?.(next)
      setMessage(`已刷新 ${result.value.models.length} 个 · ${result.value.latencyMs} ms`)
    } finally {
      setBusy(false)
    }
  }

  const currentCapabilities =
    providerId && modelId ? capabilitiesFor(providerId, modelId) : null
  const triggerLabel =
    providerId && modelId
      ? `${providerDisplayName(providerId, effectiveServices)} · ${modelId}${
          effort !== null ? ` · ${effortLabel(effort)}` : ''
        }`
      : '跟随全局默认'

  const models: PickerModel[] = active ? filterPickerModels(active.models, query) : []

  return (
    <span className="model-picker">
      <button
        ref={triggerRef}
        className={`model-picker__trigger${compact ? ' model-picker__trigger--compact' : ''}${
          open ? ' is-open' : ''
        }`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="选择模型"
        onClick={toggle}
      >
        {providerId ? <ProviderLogo providerId={providerId} size={compact ? 14 : 16} /> : null}
        <span className="model-picker__trigger-text">{triggerLabel}</span>
        <Icon name="arrow-down" size={12} />
      </button>

      {open && position ? (
        <div
          ref={panelRef}
          className="model-picker__panel"
          role="dialog"
          aria-label="选择模型"
          style={{ left: position.left, top: position.top, width: position.width }}
        >
          <div className="model-picker__rail" role="tablist" aria-label="模型来源">
            {providers.map((provider) => (
              <button
                key={provider.providerId}
                className={`model-picker__source${
                  active?.providerId === provider.providerId ? ' is-on' : ''
                }${provider.ready ? '' : ' is-off'}`}
                type="button"
                role="tab"
                aria-selected={active?.providerId === provider.providerId}
                title={`${provider.name}${provider.ready ? '' : '（未配置凭据）'}`}
                onClick={() => {
                  setActiveProviderId(provider.providerId)
                  setQuery('')
                  setMessage(null)
                }}
              >
                <ProviderLogo providerId={provider.providerId} size={18} />
                {provider.ready ? <i className="model-picker__ready" /> : null}
              </button>
            ))}
          </div>

          <div className="model-picker__tools">
            <Icon name="search" size={12} />
            <input
              value={query}
              placeholder={`搜索 ${active?.name ?? '模型'} 模型...`}
              aria-label="搜索模型"
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              className="model-picker__refresh"
              type="button"
              disabled={busy || !active?.ready || !active?.supported}
              title={
                active?.supported
                  ? '拉取该来源的最新模型'
                  : '该来源暂不支持拉取模型列表'
              }
              onClick={() => void refresh()}
            >
              ↻ {busy ? '刷新中…' : '刷新'}
            </button>
          </div>

          {message ? <p className="model-picker__message">{message}</p> : null}

          {active && !active.ready ? (
            <div className="model-picker__blocked">
              <p>还没有配置 {active.name} 的凭据，先在设置里保存 Key 才能选它的模型。</p>
              <button
                className="model-picker__link"
                type="button"
                onClick={() => {
                  onOpenSettings?.(active.providerId)
                  setOpen(false)
                }}
              >
                前往设置配置凭据 →
              </button>
            </div>
          ) : (
            <div className="model-picker__list" role="listbox" aria-label="模型列表">
              {topOption ? (
                <button
                  className={`model-picker__item${
                    modelId === topOption.value ? ' is-on' : ''
                  }`}
                  type="button"
                  role="option"
                  aria-selected={modelId === topOption.value}
                  onClick={() =>
                    commit({ providerId: null, modelId: topOption.value, effort: null })
                  }
                >
                  <span>{topOption.label}</span>
                  {modelId === topOption.value ? (
                    <span className="model-picker__check">✓</span>
                  ) : null}
                </button>
              ) : null}
              {allowDefault ? (
                <button
                  className={`model-picker__item${
                    modelId === null ? ' is-on' : ''
                  }`}
                  type="button"
                  role="option"
                  aria-selected={modelId === null}
                  onClick={() =>
                    commit({ providerId: null, modelId: null, effort: null })
                  }
                >
                  <span>跟随全局默认</span>
                  {modelId === null ? <span className="model-picker__check">✓</span> : null}
                </button>
              ) : null}
              {models.map((model) => {
                const selected = model.id === modelId
                const disabled = model.disabledReason !== null
                return (
                  <button
                    key={model.id}
                    className={`model-picker__item${selected ? ' is-on' : ''}${
                      disabled ? ' is-disabled' : ''
                    }`}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    disabled={disabled}
                    title={model.disabledReason ?? undefined}
                    onClick={() => {
                      if (!active) {
                        return
                      }
                      const caps = capabilitiesFor(active.providerId, model.id)
                      const nextEffort =
                        effort !== null && caps.supportedEfforts.includes(effort)
                          ? effort
                          : null
                      commit({
                        providerId: active.providerId,
                        modelId: model.id,
                        effort: nextEffort
                      })
                    }}
                  >
                    <span className="model-picker__model">{model.id}</span>
                    {!model.capabilities.supportsTools ? (
                      <span className="model-picker__tag">无工具</span>
                    ) : null}
                    {disabled ? (
                      <span className="model-picker__note">{model.disabledReason}</span>
                    ) : null}
                    {selected ? <span className="model-picker__check">✓</span> : null}
                  </button>
                )
              })}
              {models.length === 0 ? (
                <p className="model-picker__empty">没有匹配的模型</p>
              ) : null}
            </div>
          )}

          <div className="model-picker__effort">
            {currentCapabilities === null ? (
              <span className="model-picker__hint">选一个模型后可调思考强度</span>
            ) : currentCapabilities.effortMode === 'fixed' ? (
              <span className="model-picker__hint">深度思考（固定）</span>
            ) : currentCapabilities.effortMode === 'none' ||
              currentCapabilities.supportedEfforts.length === 0 ? (
              <span className="model-picker__hint">当前模型不支持调节思考强度</span>
            ) : (
              <>
                <span className="model-picker__hint">思考强度</span>
                <div className="model-picker__effort-track" role="group" aria-label="思考强度">
                  <button
                    className={`model-picker__effort-btn${effort === null ? ' is-on' : ''}`}
                    type="button"
                    aria-pressed={effort === null}
                    onClick={() =>
                      onChange({ providerId, modelId, effort: null })
                    }
                  >
                    默认
                  </button>
                  {EFFORT_DISPLAY_ORDER.filter((item) =>
                    currentCapabilities.supportedEfforts.includes(item)
                  ).map((item) => (
                    <button
                      key={item}
                      className={`model-picker__effort-btn${effort === item ? ' is-on' : ''}`}
                      type="button"
                      aria-pressed={effort === item}
                      onClick={() => onChange({ providerId, modelId, effort: item })}
                    >
                      {EFFORT_SHORT_LABEL[item]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </span>
  )
}
