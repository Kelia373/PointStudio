// 全屏设置中心：左侧 6 级导航 + 搜索，右侧按二级模块渲染。
//
// 真实数据优先：DeepSeek / Ollama 继续走主进程 settings；MCP 与备份走既有 IPC；
// 多服务商 / CLI 引擎 / 四槽位 / 浏览器配置属于渲染层扩展，存 localStorage。
import { useEffect, useMemo, useState } from 'react'

import { describeError } from '../../../shared/i18n/errors.ts'
import type {
  McpConnectionDto,
  ProviderAccountViewDto,
  ProviderSettingsViewDto,
  ProviderUsageDto,
  UsageBucketDto,
  UsageLedgerSummaryDto,
  UsageRangeDto
} from '../../../shared/types/ipc.ts'
import Icon from './Icon'
import ProviderLogo from './ProviderLogo'
import { AUTO_ROUTE_MODEL, MODEL_LABEL } from '../lib/modelOptions'
import {
  MODEL_SERVICES_KEY,
  addCustomApiProvider,
  buildCliInvocationPreview,
  collectModelPositionOptions,
  modelDisplayLabel,
  parseModelServicesState,
  removeCustomApiProvider,
  serializeModelServicesState,
  providerDisplayName,
  type ApiProviderProfile,
  type CliEngineProfile,
  type LocalRuntimeProfile,
  type ModelServicesState
} from '../lib/modelServices'
import type { AgentPermissionMode } from '../../../shared/types/ipc.ts'
import { mergeDiscoveredIntoServices } from '../lib/modelPicker'
import {
  filterSettingsGroups,
  findSettingsSection,
  type SettingsSectionId
} from '../lib/settingsNav'

const SLOT_CARDS: {
  key: keyof ModelServicesState['slots']
  label: string
  hint: string
  pending?: boolean
}[] = [
  { key: 'primaryModel', label: '主对话模型', hint: '默认 Agent 与新会话' },
  { key: 'fastModel', label: '轻量快反模型', hint: '标题、/side、记忆提炼', pending: true },
  { key: 'plannerModel', label: '规划与拆单模型', hint: '计划、Agent 小组拆单', pending: true },
  { key: 'embeddingModel', label: '知识库向量模型', hint: '检索增强的 embedding', pending: true }
]

const TRANSPORTS: { value: CliEngineProfile['transport']; label: string }[] = [
  { value: 'stdio-jsonl', label: 'stdio-jsonl' },
  { value: 'acp', label: 'ACP' },
  { value: 'oneshot-text', label: 'oneshot-text' }
]

const PROTOCOL_LABEL: Record<ApiProviderProfile['protocol'], string> = {
  deepseek: 'DeepSeek 原生',
  'openai-compatible': 'OpenAI 兼容',
  anthropic: 'Anthropic',
  gemini: 'Gemini'
}

/** 列表里的等宽命令预览：可执行文件 + 当前最常用的一档权限标志。 */
function cliSignature(engine: CliEngineProfile): string {
  const flag =
    engine.permissionFlags.smart ||
    engine.permissionFlags['full-access'] ||
    engine.permissionFlags['auto-edit']
  return flag === '' ? engine.executable : `${engine.executable} ${flag}`
}

function splitModels(text: string): string[] {
  return text
    .split(/[,，\n]/)
    .map((item) => item.trim())
    .filter((item) => item !== '')
}

export default function SettingsPage({ onClose }: { onClose: () => void }) {
  const [sectionId, setSectionId] = useState<SettingsSectionId>('model-services')
  const [query, setQuery] = useState('')
  const [services, setServices] = useState<ModelServicesState>(() =>
    parseModelServicesState(window.localStorage.getItem(MODEL_SERVICES_KEY))
  )
  const [provider, setProvider] = useState<ProviderSettingsViewDto | null>(null)
  const [mcp, setMcp] = useState<McpConnectionDto[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<ProviderAccountViewDto[]>([])
  const [usageByProvider, setUsageByProvider] = useState<Record<string, ProviderUsageDto>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [ledgerRange, setLedgerRange] = useState<UsageRangeDto>('7d')
  const [ledger, setLedger] = useState<UsageLedgerSummaryDto | null>(null)

  const [serviceTrack, setServiceTrack] = useState<'api' | 'cli'>('api')
  const [selectedApiId, setSelectedApiId] = useState('deepseek')
  const [providerQuery, setProviderQuery] = useState('')
  const [configuredOnly, setConfiguredOnly] = useState(false)
  const [addingProvider, setAddingProvider] = useState(false)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderBaseUrl, setNewProviderBaseUrl] = useState('')
  const [newProviderModel, setNewProviderModel] = useState('')
  const [expandedCliId, setExpandedCliId] = useState<string | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [previewMode, setPreviewMode] = useState<AgentPermissionMode>('smart')
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')

  const section = findSettingsSection(sectionId)
  const groups = useMemo(() => filterSettingsGroups(query), [query])
  const readyProviderIds = useMemo(
    () =>
      accounts
        .filter((account) => account.hasKey || account.protocol === 'ollama')
        .map((account) => account.providerId),
    [accounts]
  )
  const modelOptions = useMemo(
    () =>
      collectModelPositionOptions(
        services,
        readyProviderIds.length > 0 ? readyProviderIds : (provider?.providerId ?? null)
      ),
    [services, readyProviderIds, provider?.providerId]
  )
  const slotValues = useMemo(
    () => [AUTO_ROUTE_MODEL, ...modelOptions.map((option) => option.value)],
    [modelOptions]
  )

  useEffect(() => {
    window.localStorage.setItem(MODEL_SERVICES_KEY, serializeModelServicesState(services))
  }, [services])

  useEffect(() => {
    void (async () => {
      const [providerView, connections, accountList, ledgerView] = await Promise.all([
        window.pointstudio.settings.readProvider(),
        window.pointstudio.mcp.list(),
        window.pointstudio.providers.listAccounts(),
        window.pointstudio.providers.readLedger('7d')
      ])
      setProvider(providerView)
      setMcp(connections)
      setAccounts(accountList)
      setLedger(ledgerView)
    })()
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const api = services.api.find((item) => item.id === selectedApiId) ?? services.api[0]

  const visibleApi = services.api.filter((item) => {
    // 「已配置」以主进程真实凭据为准（hasKey），不再看目录里的 enabled 布尔位。
    if (configuredOnly && !accountOf(item.id)?.hasKey) {
      return false
    }
    const needle = providerQuery.trim().toLowerCase()
    if (needle === '') {
      return true
    }
    return (
      item.name.toLowerCase().includes(needle) ||
      item.id.toLowerCase().includes(needle) ||
      item.models.some((model) => model.toLowerCase().includes(needle))
    )
  })

  function createProvider(): void {
    if (newProviderName.trim() === '' || newProviderBaseUrl.trim() === '') {
      setMessage('自定义服务商需要名称与 Base URL')
      return
    }
    const next = addCustomApiProvider(services, {
      name: newProviderName,
      baseUrl: newProviderBaseUrl,
      model: newProviderModel
    })
    const added = next.api[next.api.length - 1]
    setServices(next)
    setSelectedApiId(added.id)
    setAddingProvider(false)
    setNewProviderName('')
    setNewProviderBaseUrl('')
    setNewProviderModel('')
    setMessage(`已添加 ${added.name}，可以继续填模型与凭据`)
  }

  function removeProvider(id: string): void {
    setServices((current) => removeCustomApiProvider(current, id))
    setSelectedApiId('deepseek')
    setMessage('已删除自定义服务商')
  }

  function patchApi(id: string, patch: Partial<ApiProviderProfile>): void {
    setServices((current) => ({
      ...current,
      api: current.api.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }))
  }

  function patchCli(id: string, patch: Partial<CliEngineProfile>): void {
    setServices((current) => ({
      ...current,
      cli: current.cli.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }))
  }

  function patchLocal(id: LocalRuntimeProfile['id'], patch: Partial<LocalRuntimeProfile>): void {
    setServices((current) => ({
      ...current,
      local: current.local.map((item) => (item.id === id ? { ...item, ...patch } : item))
    }))
  }

  function setSlot(key: keyof ModelServicesState['slots'], value: string): void {
    setServices((current) => ({ ...current, slots: { ...current.slots, [key]: value } }))
  }

  function setBrowser(patch: Partial<ModelServicesState['browser']>): void {
    setServices((current) => ({ ...current, browser: { ...current.browser, ...patch } }))
  }

  function accountOf(providerId: string): ProviderAccountViewDto | undefined {
    return accounts.find((item) => item.providerId === providerId)
  }

  /** OpenCode Go 有专属网关协议；其余沿用目录里的线路。 */
  function wireProtocolOf(
    profile: ApiProviderProfile
  ): 'openai-compatible' | 'deepseek' | 'anthropic' | 'gemini' | 'opencode-go' {
    return profile.id === 'opencode-go' ? 'opencode-go' : profile.protocol
  }

  async function refreshAccounts(): Promise<void> {
    setAccounts(await window.pointstudio.providers.listAccounts())
  }

  function refreshLedger(range: UsageRangeDto): void {
    setLedgerRange(range)
    void window.pointstudio.providers.readLedger(range).then(setLedger)
  }

  async function saveApiAccount(profile: ApiProviderProfile): Promise<void> {
    setBusyKey(`save:${profile.id}`)
    try {
      const saved = await window.pointstudio.providers.saveAccount({
        providerId: profile.id,
        protocol: wireProtocolOf(profile),
        // 只有当前行有 Key 输入；其余行留空表示沿用已保存的 Key。
        apiKey: profile.id === selectedApiId ? apiKey : '',
        baseUrl: profile.baseUrl,
        defaultModel: profile.defaultModel
      })
      if (!saved.ok) {
        setMessage(describeError(saved.code))
        return
      }
      setApiKey('')
      await refreshAccounts()
      setMessage(
        `${profile.name} 凭据已保存${
          saved.value.hasKey ? `（${saved.value.maskedKey}）` : ''
        }，切换其他服务商不会覆盖`
      )
    } finally {
      setBusyKey(null)
    }
  }

  async function clearApiAccount(providerId: string): Promise<void> {
    const cleared = await window.pointstudio.providers.clearAccount(providerId)
    if (!cleared.ok) {
      setMessage(describeError(cleared.code))
      return
    }
    await refreshAccounts()
    setMessage(`已清除 ${providerDisplayName(providerId, services)} 的凭据`)
  }

  async function fetchModelsFor(profile: ApiProviderProfile): Promise<void> {
    setBusyKey(`models:${profile.id}`)
    try {
      const result = await window.pointstudio.providers.fetchModels(profile.id)
      if (!result.ok) {
        setMessage(describeError(result.code))
        return
      }
      const discovered = result.value.models
      const selectable = discovered.filter((item) => item.selectable).length
      const skipped = discovered.length - selectable
      setServices((current) => mergeDiscoveredIntoServices(current, profile.id, discovered))
      setMessage(
        `✓ 已连通 · 获取 ${discovered.length} 个模型 · ${result.value.latencyMs} ms${
          skipped > 0 ? `（${skipped} 个仅官方客户端可用，未加入）` : ''
        }`
      )
    } finally {
      setBusyKey(null)
    }
  }

  async function fetchUsageFor(providerId: string): Promise<void> {
    setBusyKey(`usage:${providerId}`)
    try {
      const result = await window.pointstudio.providers.fetchUsage(providerId)
      if (!result.ok) {
        setMessage(describeError(result.code))
        return
      }
      setUsageByProvider((current) => ({ ...current, [providerId]: result.value }))
      setMessage(
        result.value.kind === 'unsupported'
          ? (result.value.note ?? '该平台暂未提供官方用量接口')
          : '已刷新官方用量'
      )
    } finally {
      setBusyKey(null)
    }
  }

  async function saveLocalAccount(runtime: LocalRuntimeProfile): Promise<void> {
    if (runtime.id !== 'ollama') {
      setMessage(`${runtime.name} 的主进程链路尚未接入，先只在目录里保存配置`)
      return
    }
    setBusyKey(`save:${runtime.id}`)
    try {
      const saved = await window.pointstudio.providers.saveAccount({
        providerId: runtime.id,
        protocol: 'ollama',
        baseUrl: runtime.baseUrl,
        defaultModel: runtime.models[0]
      })
      if (!saved.ok) {
        setMessage(describeError(saved.code))
        return
      }
      await refreshAccounts()
      setMessage('Ollama 已写入主进程，不影响 DeepSeek / OpenCode Go 的 Key')
    } finally {
      setBusyKey(null)
    }
  }

  function renderUsageCard(providerId: string) {
    const usage = usageByProvider[providerId]
    if (!usage) {
      return null
    }
    if (usage.kind === 'unsupported') {
      return <p className="settings-note">{usage.note}</p>
    }
    if (usage.kind === 'balance') {
      return (
        <div className="settings-usage-card">
          {(usage.balances ?? []).map((balance) => (
            <div key={balance.currency} className="settings-usage-card__row">
              <span>余额（{balance.currency}）</span>
              <b>{balance.totalBalance}</b>
              {balance.grantedBalance !== undefined ? (
                <span className="settings-note">赠金 {balance.grantedBalance}</span>
              ) : null}
              {balance.toppedUpBalance !== undefined ? (
                <span className="settings-note">充值 {balance.toppedUpBalance}</span>
              ) : null}
            </div>
          ))}
          {(usage.balances ?? []).length === 0 ? (
            <p className="settings-note">平台未返回余额明细。</p>
          ) : null}
          {usage.available === false ? (
            <p className="settings-note">该账户当前不可用（is_available=false）。</p>
          ) : null}
        </div>
      )
    }
    return (
      <div className="settings-usage-card">
        {(usage.windows ?? []).map((window) => (
          <div key={window.window} className="settings-usage-card__row">
            <span>
              {window.window === 'rolling' ? '5h 滚动' : window.window === 'weekly' ? '每周' : '每月'}
            </span>
            <span className="settings-usage-bar">
              <span
                className="settings-usage-bar__fill"
                style={{ width: `${Math.max(0, Math.min(100, window.percent))}%` }}
              />
            </span>
            <b>{window.percent}%</b>
            {window.resetsAt ? (
              <span className="settings-note">
                重置 {new Date(window.resetsAt).toLocaleString()}
              </span>
            ) : null}
          </div>
        ))}
        {(usage.windows ?? []).length === 0 ? (
          <p className="settings-note">平台未返回配额窗口。</p>
        ) : null}
      </div>
    )
  }

  function renderLedgerBuckets(buckets: UsageBucketDto[], emptyText: string) {
    if (buckets.length === 0) {
      return <p className="settings-note">{emptyText}</p>
    }
    return (
      <ul className="settings-list">
        {buckets.map((bucket) => (
          <li key={bucket.key} className="settings-usage-row">
            <span>{bucket.key === 'direct' ? '普通对话' : bucket.key}</span>
            <span className="settings-note">{bucket.calls} 次</span>
            <span>输入 {bucket.promptTokens}</span>
            <span>输出 {bucket.completionTokens}</span>
            <span>缓存命中 {bucket.cacheHitTokens}</span>
            <b>{bucket.totalTokens}</b>
          </li>
        ))}
      </ul>
    )
  }

  async function addMcp(): Promise<void> {
    const name = mcpName.trim()
    const url = mcpUrl.trim()
    if (name === '' || url === '') {
      setMessage('MCP 需要服务名与 URL')
      return
    }
    const result = await window.pointstudio.mcp.add({ serverName: name, url })
    if (!result.ok) {
      setMessage(describeError(result.code))
      return
    }
    setMcp(await window.pointstudio.mcp.list())
    setMcpName('')
    setMcpUrl('')
    setMessage(`已连接 ${name}，工具 ${result.value.toolNames.length} 个`)
  }

  async function removeMcp(serverName: string): Promise<void> {
    const result = await window.pointstudio.mcp.remove(serverName)
    if (!result.ok) {
      setMessage(describeError(result.code))
      return
    }
    setMcp(await window.pointstudio.mcp.list())
  }

  async function exportBackup(): Promise<void> {
    const result = await window.pointstudio.backup.exportText()
    if (!result.ok) {
      setMessage(describeError(result.code))
      return
    }
    try {
      await navigator.clipboard.writeText(result.value)
      setMessage('备份已复制到剪贴板，粘贴保存为 .json 即可')
    } catch {
      setMessage('复制失败：剪贴板不可用')
    }
  }

  async function importBackup(mode: 'replace' | 'merge'): Promise<void> {
    const result = await window.pointstudio.backup.importFile(mode)
    if (!result.ok) {
      setMessage(result.code === 'E_CANCELLED' ? '已取消' : describeError(result.code))
      return
    }
    const counts = result.value
    setMessage(
      counts === true
        ? '已按备份恢复数据'
        : `已合并：新增 ${counts.added} 项，跳过 ${counts.skipped} 项`
    )
  }

  function renderSection() {
    switch (sectionId) {
      case 'default-models':
        return (
          <>
            <div className="settings-card-grid">
              {SLOT_CARDS.map((card) => (
                <label key={card.key} className="settings-card">
                  <span className="settings-card__title">{card.label}</span>
                  <span className="settings-card__hint">
                    {card.hint}
                    {card.pending ? ' · 暂为占位' : ''}
                  </span>
                  <select
                    className="settings__input"
                    value={services.slots[card.key]}
                    disabled={card.pending === true}
                    onChange={(event) => setSlot(card.key, event.target.value)}
                  >
                    {card.key !== 'primaryModel' ? <option value="">未指定</option> : null}
                    {slotValues.map((value) => (
                      <option key={value} value={value}>
                        {MODEL_LABEL[value] ?? modelDisplayLabel(value, services)}
                      </option>
                    ))}
                    {services.slots[card.key] !== '' &&
                    !slotValues.includes(services.slots[card.key]) ? (
                      <option value={services.slots[card.key]}>
                        {modelDisplayLabel(services.slots[card.key], services)}
                        （当前服务商未提供）
                      </option>
                    ) : null}
                  </select>
                </label>
              ))}
            </div>
            <p className="settings-note">
              只列主进程当前服务商（DeepSeek 或 Ollama）的模型：请求只能覆盖 model，
              地址与凭据仍走主进程那一家。其它服务商先保存配置，等第 2 笔多服务商
              凭据库接入后才会出现在这里。主对话模型用于新建会话，已有会话保留各自的
              模型覆盖；其余三个槽位目前只保存配置。
            </p>
          </>
        )

      case 'model-services':
        return (
          <div className="settings-services">
            <div className="settings-seg" role="tablist" aria-label="模型服务类型">
              <button
                className={`settings-seg__btn${serviceTrack === 'api' ? ' is-on' : ''}`}
                type="button"
                role="tab"
                aria-selected={serviceTrack === 'api'}
                onClick={() => setServiceTrack('api')}
              >
                直连 API 服务
              </button>
              <button
                className={`settings-seg__btn${serviceTrack === 'cli' ? ' is-on' : ''}`}
                type="button"
                role="tab"
                aria-selected={serviceTrack === 'cli'}
                onClick={() => setServiceTrack('cli')}
              >
                CLI 智能体引擎
              </button>
            </div>

            {serviceTrack === 'api' ? (
              <div className="settings-split">
                <div className="settings-rail">
                  <div className="settings-rail__search">
                    <Icon name="search" size={12} />
                    <input
                      value={providerQuery}
                      placeholder="搜索模型平台..."
                      aria-label="搜索模型平台"
                      onChange={(event) => setProviderQuery(event.target.value)}
                    />
                    <button
                      className={`settings-rail__filter${configuredOnly ? ' is-on' : ''}`}
                      type="button"
                      aria-pressed={configuredOnly}
                      title={configuredOnly ? '显示全部平台' : '仅看已配置'}
                      aria-label={configuredOnly ? '显示全部平台' : '仅看已配置'}
                      onClick={() => setConfiguredOnly((value) => !value)}
                    >
                      <Icon name="filter" size={12} />
                    </button>
                  </div>
                  <ul className="settings-list">
                    {visibleApi.map((item) => (
                      <li key={item.id}>
                        <button
                          className={`settings-list__item${
                            item.id === api?.id ? ' is-on' : ''
                          }`}
                          type="button"
                          onClick={() => setSelectedApiId(item.id)}
                        >
                          <span className="settings-list__logo">
                            <ProviderLogo providerId={item.id} size={16} />
                          </span>
                          <span className="settings-list__name">{item.name}</span>
                          <span
                            className={`settings-dot${accountOf(item.id)?.hasKey ? ' is-on' : ''}`}
                            title={
                              accountOf(item.id)?.hasKey ? '已配置凭据' : '未配置凭据'
                            }
                          />
                        </button>
                      </li>
                    ))}
                    {visibleApi.length === 0 ? (
                      <li className="settings-note">没有匹配的平台。</li>
                    ) : null}
                  </ul>
                  {addingProvider ? (
                    <div className="settings-rail__new">
                      <input
                        className="settings__input"
                        value={newProviderName}
                        placeholder="服务商名称"
                        aria-label="服务商名称"
                        onChange={(event) => setNewProviderName(event.target.value)}
                      />
                      <input
                        className="settings__input"
                        value={newProviderBaseUrl}
                        placeholder="https://api.example.com/v1"
                        aria-label="Base URL"
                        onChange={(event) => setNewProviderBaseUrl(event.target.value)}
                      />
                      <input
                        className="settings__input"
                        value={newProviderModel}
                        placeholder="首个模型（可选）"
                        aria-label="首个模型"
                        onChange={(event) => setNewProviderModel(event.target.value)}
                      />
                      <div className="settings-rail__new-actions">
                        <button
                          className="settings__save"
                          type="button"
                          onClick={() => createProvider()}
                        >
                          创建
                        </button>
                        <button
                          className="settings__clear"
                          type="button"
                          onClick={() => setAddingProvider(false)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="settings-rail__add"
                      type="button"
                      onClick={() => setAddingProvider(true)}
                    >
                      <Icon name="plus" size={12} />
                      添加服务商
                    </button>
                  )}
                </div>

                {api ? (
                  <div className="settings-form">
                    <div className="settings-detail__head">
                      <span className="settings-detail__logo">
                        <ProviderLogo providerId={api.id} size={28} />
                      </span>
                      <span className="settings-detail__title">
                        <span className="settings-detail__name">{api.name}</span>
                        <span className="settings-detail__badge">
                          {PROTOCOL_LABEL[api.protocol]} · {api.id}
                        </span>
                      </span>
                      <span
                        className={`settings-dot${accountOf(api.id)?.hasKey ? ' is-on' : ''}`}
                        title={
                          accountOf(api.id)?.hasKey
                            ? `已配置 ${accountOf(api.id)?.maskedKey}`
                            : '未配置凭据'
                        }
                      />
                    </div>

                    <label className="settings__row">
                      <span className="settings__label">Base URL</span>
                      <input
                        className="settings__input"
                        value={api.baseUrl}
                        onChange={(event) =>
                          patchApi(api.id, { baseUrl: event.target.value })
                        }
                      />
                    </label>
                    <label className="settings__row">
                      <span className="settings__label">模型列表（逗号分隔）</span>
                      <input
                        className="settings__input"
                        value={api.models.join(', ')}
                        onChange={(event) =>
                          patchApi(api.id, { models: splitModels(event.target.value) })
                        }
                      />
                    </label>
                    <label className="settings__row">
                      <span className="settings__label">默认模型</span>
                      <input
                        className="settings__input"
                        value={api.defaultModel}
                        onChange={(event) =>
                          patchApi(api.id, { defaultModel: event.target.value })
                        }
                      />
                    </label>

                    <label className="settings__row">
                      <span className="settings__label">API Key</span>
                      <input
                        className="settings__input"
                        type="password"
                        value={apiKey}
                        placeholder={
                          accountOf(api.id)?.hasKey
                            ? `已保存 ${accountOf(api.id)?.maskedKey}，留空则不修改`
                            : 'sk-...'
                        }
                        onChange={(event) => setApiKey(event.target.value)}
                      />
                    </label>
                    <div className="settings__actions">
                      <button
                        className="settings__save"
                        type="button"
                        disabled={
                          busyKey === `save:${api.id}` ||
                          api.protocol === 'anthropic' ||
                          api.protocol === 'gemini'
                        }
                        title={
                          api.protocol === 'anthropic' || api.protocol === 'gemini'
                            ? '原生协议适配器排后续，本期只接通 OpenAI 兼容线'
                            : '保存到多服务商凭据库'
                        }
                        onClick={() => void saveApiAccount(api)}
                      >
                        {busyKey === `save:${api.id}` ? '保存中…' : '保存凭据'}
                      </button>
                      <button
                        className="settings__save"
                        type="button"
                        disabled={
                          busyKey === `models:${api.id}` ||
                          api.protocol === 'anthropic' ||
                          api.protocol === 'gemini'
                        }
                        onClick={() => void fetchModelsFor(api)}
                      >
                        {busyKey === `models:${api.id}` ? '拉取中…' : '拉取模型列表'}
                      </button>
                      <button
                        className="settings__clear"
                        type="button"
                        disabled={
                          busyKey === `usage:${api.id}` ||
                          api.protocol === 'anthropic' ||
                          api.protocol === 'gemini'
                        }
                        onClick={() => void fetchUsageFor(api.id)}
                      >
                        {busyKey === `usage:${api.id}` ? '刷新中…' : '刷新余额/配额'}
                      </button>
                      {accountOf(api.id)?.hasKey ? (
                        <button
                          className="settings__clear"
                          type="button"
                          onClick={() => void clearApiAccount(api.id)}
                        >
                          清除凭据
                        </button>
                      ) : null}
                    </div>
                    <p className="settings-note">
                      凭据按服务商独立保存（userData/provider-accounts.json），切换别的平台不会覆盖这一家。
                      {api.id === 'opencode-go'
                        ? ' OpenCode Go 走 /inference/go 网关，模型与用量由官方接口实时返回。'
                        : ''}
                      {api.protocol === 'anthropic' || api.protocol === 'gemini'
                        ? ' 该平台是原生协议，适配器排后续；本期只接通 OpenAI 兼容线（DeepSeek / OpenCode Go / 各兼容平台 / Ollama）。'
                        : ''}
                    </p>
                    {renderUsageCard(api.id)}

                    {api.id.startsWith('custom-') ? (
                      <button
                        className="settings__clear"
                        type="button"
                        onClick={() => removeProvider(api.id)}
                      >
                        删除这个自定义服务商
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <ul className="settings-cli">
                {services.cli.map((engine) => {
                  const open = expandedCliId === engine.id
                  return (
                    <li
                      key={engine.id}
                      className={`settings-cli__row${open ? ' is-open' : ''}`}
                    >
                      <div className="settings-cli__line">
                        <span className="settings-cli__logo">
                          <ProviderLogo providerId={engine.id} size={22} />
                        </span>
                        <span className="settings-cli__text">
                          <span className="settings-cli__name">{engine.name}</span>
                          <code className="settings-cli__cmd">{cliSignature(engine)}</code>
                        </span>
                        <span
                          className="settings-cli__mode"
                          role="group"
                          aria-label={`${engine.name} 启动方式`}
                        >
                          {(['chat', 'cli'] as const).map((mode) => (
                            <button
                              key={mode}
                              className={engine.launchMode === mode ? 'is-on' : ''}
                              type="button"
                              aria-pressed={engine.launchMode === mode}
                              onClick={() => patchCli(engine.id, { launchMode: mode })}
                            >
                              {mode === 'chat' ? '聊天' : 'CLI'}
                            </button>
                          ))}
                        </span>
                        <label
                          className="settings-toggle"
                          title={engine.enabled ? '停用该引擎' : '启用该引擎'}
                        >
                          <input
                            type="checkbox"
                            checked={engine.enabled}
                            aria-label={`启用 ${engine.name}`}
                            onChange={(event) =>
                              patchCli(engine.id, { enabled: event.target.checked })
                            }
                          />
                          <span className="settings-toggle__track">
                            <span className="settings-toggle__thumb" />
                          </span>
                        </label>
                        <button
                          className="settings-cli__more"
                          type="button"
                          aria-expanded={open}
                          aria-label={`展开 ${engine.name} 配置`}
                          onClick={() => setExpandedCliId(open ? null : engine.id)}
                        >
                          <Icon name="chevron-right" size={13} />
                        </button>
                      </div>

                      {open ? (
                        <div className="settings-cli__body">
                          <label className="settings__row">
                            <span className="settings__label">可执行命令</span>
                            <input
                              className="settings__input"
                              value={engine.executable}
                              onChange={(event) =>
                                patchCli(engine.id, { executable: event.target.value })
                              }
                            />
                          </label>
                          <label className="settings__row">
                            <span className="settings__label">通信协议</span>
                            <select
                              className="settings__input"
                              value={engine.transport}
                              onChange={(event) =>
                                patchCli(engine.id, {
                                  transport: event.target
                                    .value as CliEngineProfile['transport']
                                })
                              }
                            >
                              {TRANSPORTS.map((item) => (
                                <option key={item.value} value={item.value}>
                                  {item.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="settings__row">
                            <span className="settings__label">
                              参数模板（{`{{workspace}} {{model}} {{prompt}}`}）
                            </span>
                            <input
                              className="settings__input"
                              value={engine.argsTemplate}
                              onChange={(event) =>
                                patchCli(engine.id, {
                                  argsTemplate: event.target.value
                                })
                              }
                            />
                          </label>
                          {(['auto-edit', 'smart', 'full-access'] as const).map((mode) => (
                            <label className="settings__row" key={mode}>
                              <span className="settings__label">权限参数 · {mode}</span>
                              <input
                                className="settings__input"
                                value={engine.permissionFlags[mode]}
                                onChange={(event) =>
                                  patchCli(engine.id, {
                                    permissionFlags: {
                                      ...engine.permissionFlags,
                                      [mode]: event.target.value
                                    }
                                  })
                                }
                              />
                            </label>
                          ))}
                          <div className="settings__row">
                            <span className="settings__label">命令预览</span>
                            <select
                              className="settings__input"
                              value={previewMode}
                              onChange={(event) =>
                                setPreviewMode(event.target.value as AgentPermissionMode)
                              }
                            >
                              <option value="auto-edit">auto-edit</option>
                              <option value="smart">smart</option>
                              <option value="full-access">full-access</option>
                            </select>
                          </div>
                          <pre className="settings-preview">
                            {buildCliInvocationPreview(engine, {
                              permissionMode: previewMode,
                              workspace: 'D:/Project/PointStudio',
                              model: 'deepseek-chat',
                              prompt: '修复登录'
                            })}
                          </pre>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )

      case 'local-models':
        return (
          <>
            <div className="settings-card-grid">
              {services.local.map((runtime) => (
                <div key={runtime.id} className="settings-card">
                  <span className="settings-card__title">{runtime.name}</span>
                  <label className="settings__row">
                    <span className="settings__label">启用</span>
                    <input
                      type="checkbox"
                      checked={runtime.enabled}
                      onChange={(event) =>
                        patchLocal(runtime.id, { enabled: event.target.checked })
                      }
                    />
                  </label>
                  <label className="settings__row">
                    <span className="settings__label">Base URL</span>
                    <input
                      className="settings__input"
                      value={runtime.baseUrl}
                      onChange={(event) =>
                        patchLocal(runtime.id, { baseUrl: event.target.value })
                      }
                    />
                  </label>
                  <label className="settings__row">
                    <span className="settings__label">模型（逗号分隔）</span>
                    <input
                      className="settings__input"
                      value={runtime.models.join(', ')}
                      onChange={(event) =>
                        patchLocal(runtime.id, { models: splitModels(event.target.value) })
                      }
                    />
                  </label>
                  <label className="settings__row">
                    <span className="settings__label">numCtx</span>
                    <input
                      className="settings__input"
                      type="number"
                      value={runtime.numCtx}
                      onChange={(event) =>
                        patchLocal(runtime.id, { numCtx: Number(event.target.value) || 0 })
                      }
                    />
                  </label>
                  {runtime.id === 'ollama' ? (
                    <>
                      <div className="settings__actions">
                        <button
                          className="settings__save"
                          type="button"
                          disabled={busyKey === 'save:ollama'}
                          onClick={() => void saveLocalAccount(runtime)}
                        >
                          {busyKey === 'save:ollama' ? '保存中…' : '写入主进程'}
                        </button>
                        <button
                          className="settings__clear"
                          type="button"
                          disabled={busyKey === 'models:ollama'}
                          onClick={() =>
                            void fetchModelsFor({
                              id: runtime.id,
                              kind: 'api',
                              name: runtime.name,
                              protocol: 'openai-compatible',
                              enabled: runtime.enabled,
                              baseUrl: runtime.baseUrl,
                              models: runtime.models,
                              defaultModel: runtime.models[0] ?? ''
                            })
                          }
                        >
                          {busyKey === 'models:ollama' ? '拉取中…' : '拉取本地模型'}
                        </button>
                      </div>
                      <p className="settings-note">
                        写入主进程只送 Base URL 与首个模型；numCtx / keepAlive 仅本地保存。
                      </p>
                    </>
                  ) : (
                    <p className="settings-note">
                      {runtime.name} 只保存在渲染层配置，主进程真链路留后续专题。
                    </p>
                  )}
                </div>
            ))}
            </div>
            <p className="settings-note">
              多服务商凭据库已启用：每家一条记录，写 Ollama 不会再覆盖 DeepSeek /
              OpenCode Go 的 Key。LM Studio / vLLM 仍只保存在目录里，主进程链路留后续。
            </p>
          </>
        )

      case 'browser':
        return (
          <div className="settings-form">
            <label className="settings__row">
              <span className="settings__label">驱动模式</span>
              <select
                className="settings__input"
                value={services.browser.driver}
                onChange={(event) =>
                  setBrowser({
                    driver: event.target.value as ModelServicesState['browser']['driver']
                  })
                }
              >
                <option value="agent-browser-sandbox">agent-browser / CDP 沙箱</option>
                <option value="local-cdp-attach">本机 CDP 端口挂接</option>
              </select>
            </label>
            <label className="settings__row">
              <span className="settings__label">CDP 端口</span>
              <input
                className="settings__input"
                type="number"
                value={services.browser.cdpPort}
                onChange={(event) =>
                  setBrowser({ cdpPort: Number(event.target.value) || 0 })
                }
              />
            </label>
            <label className="settings__row">
              <span className="settings__label">感知模式</span>
              <select
                className="settings__input"
                value={services.browser.perceptionMode}
                onChange={(event) =>
                  setBrowser({
                    perceptionMode: event.target.value as ModelServicesState['browser']['perceptionMode']
                  })
                }
              >
                <option value="axtree-first">AXTree @eN</option>
                <option value="som-visual-hybrid">AXTree + SoM 视觉贴纸</option>
              </select>
            </label>
            <label className="settings__row">
              <span className="settings__label">smart 权限门拦截提交</span>
              <input
                type="checkbox"
                checked={services.browser.smartGateOnSubmit}
                onChange={(event) => setBrowser({ smartGateOnSubmit: event.target.checked })}
              />
            </label>
            <label className="settings__row">
              <span className="settings__label">右屏副驾实时预览</span>
              <input
                type="checkbox"
                checked={services.browser.rightPaneLivePreview}
                onChange={(event) =>
                  setBrowser({ rightPaneLivePreview: event.target.checked })
                }
              />
            </label>
            <label className="settings__row">
              <span className="settings__label">一次探路自动固化 Skill</span>
              <input
                type="checkbox"
                checked={services.browser.autoSolidifySkill}
                onChange={(event) =>
                  setBrowser({ autoSolidifySkill: event.target.checked })
                }
              />
            </label>
          </div>
        )

      case 'mcp':
        return (
          <div className="settings-form">
            <ul className="settings-list">
              {mcp.map((connection) => (
                <li key={connection.serverName} className="settings-mcp">
                  <span>{connection.serverName}</span>
                  <code>{connection.url}</code>
                  <button
                    className="settings__clear"
                    type="button"
                    onClick={() => void removeMcp(connection.serverName)}
                  >
                    断开
                  </button>
                </li>
              ))}
              {mcp.length === 0 ? <li className="settings-note">还没有连接 MCP 服务。</li> : null}
            </ul>
            <label className="settings__row">
              <span className="settings__label">服务名</span>
              <input
                className="settings__input"
                value={mcpName}
                onChange={(event) => setMcpName(event.target.value)}
              />
            </label>
            <label className="settings__row">
              <span className="settings__label">URL</span>
              <input
                className="settings__input"
                value={mcpUrl}
                placeholder="http://127.0.0.1:3000/mcp"
                onChange={(event) => setMcpUrl(event.target.value)}
              />
            </label>
            <button className="settings__save" type="button" onClick={() => void addMcp()}>
              连接
            </button>
          </div>
        )

      case 'usage':
        return (
          <div className="settings-form">
            <p className="settings-note">
              上半部分是各平台官方余额 / 配额（DeepSeek 余额、OpenCode Go 5h/周/月），
              下半部分是本机真实 Token 账本（来自流式响应的 usage 尾帧）。
            </p>
            <div className="settings-usage-section">
              <span className="settings-usage-section__title">官方余额 / 配额</span>
              {accounts.length === 0 ? (
                <p className="settings-note">还没有保存任何服务商凭据。</p>
              ) : (
                accounts.map((account) => (
                  <div key={account.providerId} className="settings-usage-block">
                    <div className="settings-usage-block__head">
                      <span>{providerDisplayName(account.providerId, services)}</span>
                      <span className="settings-note">
                        {account.hasKey ? account.maskedKey : '未配置凭据'}
                      </span>
                      <button
                        className="settings__clear"
                        type="button"
                        disabled={busyKey === `usage:${account.providerId}`}
                        onClick={() => void fetchUsageFor(account.providerId)}
                      >
                        {busyKey === `usage:${account.providerId}` ? '刷新中…' : '刷新'}
                      </button>
                    </div>
                    {renderUsageCard(account.providerId)}
                  </div>
                ))
              )}
            </div>

            <div className="settings-usage-section">
              <span className="settings-usage-section__title">本地 Token 账本</span>
              <div className="settings-seg" role="tablist" aria-label="账本时间范围">
                {(['today', '7d', '30d', 'all'] as const).map((range) => (
                  <button
                    key={range}
                    className={`settings-seg__btn${ledgerRange === range ? ' is-on' : ''}`}
                    type="button"
                    role="tab"
                    aria-selected={ledgerRange === range}
                    onClick={() => refreshLedger(range)}
                  >
                    {range === 'today' ? '今日' : range === '7d' ? '7 天' : range === '30d' ? '30 天' : '全部'}
                  </button>
                ))}
              </div>
              {ledger ? (
                <>
                  <p className="settings-note">
                    共 {ledger.totalCalls} 次调用 · 输入 {ledger.totalPromptTokens} · 输出{' '}
                    {ledger.totalCompletionTokens} · 缓存命中 {ledger.totalCacheHitTokens} · 合计{' '}
                    {ledger.totalTokens}
                  </p>
                  <div className="settings-usage-section">
                    <span className="settings-usage-section__title">按服务商</span>
                    {renderLedgerBuckets(ledger.byProvider, '这个时间窗还没有真实调用。')}
                  </div>
                  <div className="settings-usage-section">
                    <span className="settings-usage-section__title">按驻场 Agent</span>
                    {renderLedgerBuckets(ledger.byAssistant, '这个时间窗还没有真实调用。')}
                  </div>
                </>
              ) : (
                <p className="settings-note">正在读取账本…</p>
              )}
            </div>
          </div>
        )

      case 'data-backup':
        return (
          <div className="settings-form">
            <p className="settings-note">
              导出为 JSON 文本（含会话、助手与设置）；恢复时可选清空写入或只合并新增。
            </p>
            <div className="settings__actions">
              <button className="settings__save" type="button" onClick={() => void exportBackup()}>
                复制备份
              </button>
              <button
                className="settings__clear"
                type="button"
                onClick={() => void importBackup('merge')}
              >
                合并导入
              </button>
              <button
                className="settings__clear"
                type="button"
                onClick={() => void importBackup('replace')}
              >
                清空并恢复
              </button>
            </div>
          </div>
        )

      default:
        return (
          <div className="settings-form">
            <p className="settings-note">{section.description}</p>
            <p className="settings-note">这一块还没接入真实数据，先保留结构占位。</p>
          </div>
        )
    }
  }

  return (
    <div className="settings-page" role="dialog" aria-modal="true" aria-label="设置">
      <div className="settings-page__side">
        <div className="settings-page__title">设置</div>
        <div className="settings-search">
          <Icon name="search" size={13} />
          <input
            value={query}
            placeholder="搜索设置"
            aria-label="搜索设置"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <nav className="settings-page__nav">
          {groups.map((group) => (
            <div key={group.id} className="settings-nav-group">
              <span className="settings-nav-group__label">{group.label}</span>
              {group.sections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-current={item.id === sectionId}
                  onClick={() => {
                    setSectionId(item.id)
                    setMessage(null)
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 ? <p className="settings-note">没有匹配的设置项。</p> : null}
        </nav>
      </div>

      <div className="settings-page__main">
        <header className="settings-page__head">
          <h2>{section.label}</h2>
          <span className="topbar__spacer" />
          <button
            className="icon-btn"
            type="button"
            onClick={onClose}
            title="关闭设置"
            aria-label="关闭设置"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="settings-page__body">
          {message ? <div className="settings__message">{message}</div> : null}
          {renderSection()}
        </div>
      </div>
    </div>
  )
}
