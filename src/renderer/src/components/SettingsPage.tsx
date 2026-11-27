// 全屏设置中心：左侧 6 级导航 + 搜索，右侧按二级模块渲染。
//
// 真实数据优先：DeepSeek / Ollama 继续走主进程 settings；MCP 与备份走既有 IPC；
// 多服务商 / CLI 引擎 / 四槽位 / 浏览器配置属于渲染层扩展，存 localStorage。
import { useEffect, useMemo, useState } from 'react'

import { describeError } from '../../../shared/i18n/errors.ts'
import type { McpConnectionDto, ProviderSettingsViewDto } from '../../../shared/types/ipc.ts'
import Icon from './Icon'
import { AUTO_ROUTE_MODEL, MODEL_LABEL } from '../lib/modelOptions'
import {
  MODEL_SERVICES_KEY,
  buildCliInvocationPreview,
  collectAvailableModelOptions,
  modelDisplayLabel,
  parseModelServicesState,
  serializeModelServicesState,
  type ApiProviderProfile,
  type CliEngineProfile,
  type LocalRuntimeProfile,
  type ModelServicesState
} from '../lib/modelServices'
import type { AgentPermissionMode } from '../../../shared/types/ipc.ts'
import {
  filterSettingsGroups,
  findSettingsSection,
  type SettingsSectionId
} from '../lib/settingsNav'

const SLOT_CARDS: { key: keyof ModelServicesState['slots']; label: string; hint: string }[] = [
  { key: 'primaryModel', label: '主对话模型', hint: '默认 Agent 与新会话' },
  { key: 'fastModel', label: '轻量快反模型', hint: '标题、/side、记忆提炼' },
  { key: 'plannerModel', label: '规划与拆单模型', hint: '计划、Agent 小组拆单' },
  { key: 'embeddingModel', label: '知识库向量模型', hint: '检索增强的 embedding' }
]

const TRANSPORTS: { value: CliEngineProfile['transport']; label: string }[] = [
  { value: 'stdio-jsonl', label: 'stdio-jsonl' },
  { value: 'acp', label: 'ACP' },
  { value: 'oneshot-text', label: 'oneshot-text' }
]

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

  const [serviceTrack, setServiceTrack] = useState<'api' | 'cli'>('api')
  const [selectedApiId, setSelectedApiId] = useState('deepseek')
  const [selectedCliId, setSelectedCliId] = useState('opencode')
  const [apiKey, setApiKey] = useState('')
  const [previewMode, setPreviewMode] = useState<AgentPermissionMode>('smart')
  const [mcpName, setMcpName] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')

  const section = findSettingsSection(sectionId)
  const groups = useMemo(() => filterSettingsGroups(query), [query])
  const modelOptions = useMemo(() => collectAvailableModelOptions(services), [services])
  const slotValues = useMemo(
    () => [AUTO_ROUTE_MODEL, ...modelOptions.map((option) => option.value)],
    [modelOptions]
  )

  useEffect(() => {
    window.localStorage.setItem(MODEL_SERVICES_KEY, serializeModelServicesState(services))
  }, [services])

  useEffect(() => {
    void (async () => {
      const [providerView, connections] = await Promise.all([
        window.pointstudio.settings.readProvider(),
        window.pointstudio.mcp.list()
      ])
      setProvider(providerView)
      setMcp(connections)
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
  const cli = services.cli.find((item) => item.id === selectedCliId) ?? services.cli[0]

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

  async function saveDeepSeek(): Promise<void> {
    const saved = await window.pointstudio.settings.saveProvider({
      providerId: 'deepseek',
      apiKey,
      baseUrl: api?.baseUrl,
      model: api?.defaultModel
    })
    if (!saved.ok) {
      setMessage(describeError(saved.code))
      return
    }
    setProvider(saved.value)
    setApiKey('')
    setMessage('DeepSeek 已保存，下一轮对话立即生效')
  }

  async function saveOllama(runtime: LocalRuntimeProfile): Promise<void> {
    const saved = await window.pointstudio.settings.saveProvider({
      providerId: 'ollama',
      baseUrl: runtime.baseUrl,
      model: runtime.models[0]
    })
    if (!saved.ok) {
      setMessage(describeError(saved.code))
      return
    }
    setProvider(saved.value)
    setMessage('Ollama 配置已写入主进程')
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
          <div className="settings-card-grid">
            {SLOT_CARDS.map((card) => (
              <label key={card.key} className="settings-card">
                <span className="settings-card__title">{card.label}</span>
                <span className="settings-card__hint">{card.hint}</span>
                <select
                  className="settings__input"
                  value={services.slots[card.key]}
                  onChange={(event) => setSlot(card.key, event.target.value)}
                >
                  {card.key !== 'primaryModel' ? <option value="">未指定</option> : null}
                  {slotValues.map((value) => (
                    <option key={value} value={value}>
                      {MODEL_LABEL[value] ?? modelDisplayLabel(value, services)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
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
                <ul className="settings-list">
                  {services.api.map((item) => (
                    <li key={item.id}>
                      <button
                        className={`settings-list__item${
                          item.id === api?.id ? ' is-on' : ''
                        }`}
                        type="button"
                        onClick={() => setSelectedApiId(item.id)}
                      >
                        <span>{item.name}</span>
                        <span className={`settings-dot${item.enabled ? ' is-on' : ''}`} />
                      </button>
                    </li>
                  ))}
                </ul>
                {api ? (
                  <div className="settings-form">
                    <label className="settings__row">
                      <span className="settings__label">启用</span>
                      <input
                        type="checkbox"
                        checked={api.enabled}
                        onChange={(event) =>
                          patchApi(api.id, { enabled: event.target.checked })
                        }
                      />
                    </label>
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

                    {api.id === 'deepseek' ? (
                      <>
                        <label className="settings__row">
                          <span className="settings__label">API Key</span>
                          <input
                            className="settings__input"
                            type="password"
                            value={apiKey}
                            placeholder={
                              provider?.hasKey
                                ? `已保存 ${provider.maskedKey}，留空则不修改`
                                : 'sk-...'
                            }
                            onChange={(event) => setApiKey(event.target.value)}
                          />
                        </label>
                        <div className="settings__actions">
                          <button
                            className="settings__save"
                            type="button"
                            onClick={() => void saveDeepSeek()}
                          >
                            保存到主进程
                          </button>
                          <button
                            className="settings__clear"
                            type="button"
                            onClick={() => {
                              void window.pointstudio.settings.clearProvider().then(() => {
                                setMessage('已清除主进程凭据')
                                void window.pointstudio.settings
                                  .readProvider()
                                  .then(setProvider)
                              })
                            }}
                          >
                            清除凭据
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="settings-note">
                        本期只有 DeepSeek 与 Ollama 走主进程凭据；其余 API 先保存配置，
                        Key 接入留后续主进程专题。
                      </p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="settings-split">
                <ul className="settings-list">
                  {services.cli.map((item) => (
                    <li key={item.id}>
                      <button
                        className={`settings-list__item${
                          item.id === cli?.id ? ' is-on' : ''
                        }`}
                        type="button"
                        onClick={() => setSelectedCliId(item.id)}
                      >
                        <span>{item.name}</span>
                        <span className={`settings-dot${item.enabled ? ' is-on' : ''}`} />
                      </button>
                    </li>
                  ))}
                </ul>
                {cli ? (
                  <div className="settings-form">
                    <label className="settings__row">
                      <span className="settings__label">启用该引擎</span>
                      <input
                        type="checkbox"
                        checked={cli.enabled}
                        onChange={(event) =>
                          patchCli(cli.id, { enabled: event.target.checked })
                        }
                      />
                    </label>
                    <label className="settings__row">
                      <span className="settings__label">可执行命令</span>
                      <input
                        className="settings__input"
                        value={cli.executable}
                        onChange={(event) =>
                          patchCli(cli.id, { executable: event.target.value })
                        }
                      />
                    </label>
                    <label className="settings__row">
                      <span className="settings__label">通信协议</span>
                      <select
                        className="settings__input"
                        value={cli.transport}
                        onChange={(event) =>
                          patchCli(cli.id, {
                            transport: event.target.value as CliEngineProfile['transport']
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
                        value={cli.argsTemplate}
                        onChange={(event) =>
                          patchCli(cli.id, { argsTemplate: event.target.value })
                        }
                      />
                    </label>
                    {(['auto-edit', 'smart', 'full-access'] as const).map((mode) => (
                      <label className="settings__row" key={mode}>
                        <span className="settings__label">权限参数 · {mode}</span>
                        <input
                          className="settings__input"
                          value={cli.permissionFlags[mode]}
                          onChange={(event) =>
                            patchCli(cli.id, {
                              permissionFlags: { ...cli.permissionFlags, [mode]: event.target.value }
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
                      {buildCliInvocationPreview(cli, {
                        permissionMode: previewMode,
                        workspace: 'D:/Project/PointStudio',
                        model: cli.name,
                        prompt: '修复登录'
                      })}
                    </pre>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        )

      case 'local-models':
        return (
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
                  <button
                    className="settings__save"
                    type="button"
                    onClick={() => void saveOllama(runtime)}
                  >
                    写入主进程
                  </button>
                ) : (
                  <p className="settings-note">LM Studio 仅渲染层配置，主进程接入留后续。</p>
                )}
              </div>
            ))}
          </div>
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
