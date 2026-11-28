// lib/modelServices —— 双轨模型接入的状态与纯函数。
//
// 主进程只认识 SETTINGS_CHANNELS 里的单一 provider（deepseek / ollama）；
// 多服务商、CLI 引擎、本地运行时与四槽位属于渲染层扩展，存 localStorage，
// 不新增 IPC 通道，也不改 providerSettings 的既有契约。
import type { AgentPermissionMode } from '../../../shared/types/ipc.ts'
import { uiPermissionMode } from './permissionModes.ts'
import { AUTO_ROUTE_MODEL, MODEL_LABEL } from './modelOptions.ts'

export const MODEL_SERVICES_KEY = 'pointstudio.modelServices'

export type ModelServiceKind = 'api' | 'cli' | 'local'
import type { ModelCapabilitiesDto, ReasoningEffortDto } from '../../../shared/types/ipc.ts'

export type ApiProtocolKind = 'openai-compatible' | 'deepseek' | 'anthropic' | 'gemini'
export type CliEnginePresetId =
  | 'opencode'
  | 'paseo'
  | 'devin'
  | 'claude-code'
  | 'codex'
  | 'cursor'
  | 'kimi-cli'
  | 'qwen-code'
  | 'openclaw'
  | 'codebuddy'
  | 'continue'
  | 'mistral-vibe'
  | 'custom-command'
export type CliTransportMode = 'stdio-jsonl' | 'acp' | 'oneshot-text'

export interface ApiProviderProfile {
  id: string
  kind: 'api'
  name: string
  protocol: ApiProtocolKind
  enabled: boolean
  baseUrl: string
  models: string[]
  defaultModel: string
  hasKey?: boolean
  maskedKey?: string
  /** fetchModels 拉回的真实能力画像（按模型 id 缓存）。 */
  modelCapabilities?: Record<string, ModelCapabilitiesDto>
  /** 不可直选的模型 → 原因（如 -free）。 */
  unselectableModels?: Record<string, string>
}

export interface CliEngineProfile {
  id: string
  kind: 'cli'
  preset: CliEnginePresetId
  name: string
  enabled: boolean
  /** 右侧「聊天 | CLI」分段：chat = 会话式，cli = 命令行引擎。 */
  launchMode: 'chat' | 'cli'
  executable: string
  transport: CliTransportMode
  argsTemplate: string
  permissionFlags: Record<'auto-edit' | 'smart' | 'full-access', string>
  cwdPolicy: 'workspace' | 'custom'
  customCwd?: string
}

export interface LocalRuntimeProfile {
  id: 'ollama' | 'lm-studio' | 'vllm'
  kind: 'local'
  name: string
  enabled: boolean
  baseUrl: string
  models: string[]
  numCtx: number
  keepAliveMinutes: number
  modelCapabilities?: Record<string, ModelCapabilitiesDto>
  unselectableModels?: Record<string, string>
}

export interface DefaultModelSlots {
  primaryModel: string
  fastModel: string
  plannerModel: string
  embeddingModel: string
}

export interface AgentBrowserWorkflowConfig {
  driver: 'agent-browser-sandbox' | 'local-cdp-attach'
  cdpPort: number
  perceptionMode: 'axtree-first' | 'som-visual-hybrid'
  smartGateOnSubmit: boolean
  rightPaneLivePreview: boolean
  autoSolidifySkill: boolean
}

export interface ModelServicesState {
  api: ApiProviderProfile[]
  cli: CliEngineProfile[]
  local: LocalRuntimeProfile[]
  slots: DefaultModelSlots
  browser: AgentBrowserWorkflowConfig
}

export interface ModelOption {
  value: string
  label: string
  kind: ModelServiceKind
  /** 模型位专用：这个模型属于哪家服务商（用于同时落 providerId + modelId）。 */
  providerId?: string
  modelId?: string
}

const FLAGS = {
  'auto-edit': '--allow-edits',
  smart: '--smart-approve',
  'full-access': '--dangerously-skip-permissions'
} as const

/** 完整预置目录：14 API / 13 CLI / 3 本地，首次打开与坏数据回退都用它。 */
export function createDefaultModelServicesState(): ModelServicesState {
  return {
    api: [
      {
        id: 'deepseek',
        kind: 'api',
        name: 'DeepSeek',
        protocol: 'deepseek',
        enabled: true,
        baseUrl: 'https://api.deepseek.com',
        models: ['deepseek-chat', 'deepseek-reasoner'],
        defaultModel: 'deepseek-chat'
      },
      {
        id: 'opencode-go',
        kind: 'api',
        name: 'OpenCode Go',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://opencode.ai/inference/go/openai/v1',
        models: ['kimi-k2.5', 'deepseek-v3', 'glm-4.5'],
        defaultModel: 'kimi-k2.5'
      },
      {
        id: 'openai',
        kind: 'api',
        name: 'OpenAI',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://api.openai.com/v1',
        models: ['gpt-5.1', 'gpt-5-mini'],
        defaultModel: 'gpt-5.1'
      },
      {
        id: 'anthropic',
        kind: 'api',
        name: 'Anthropic / Claude',
        protocol: 'anthropic',
        enabled: false,
        baseUrl: 'https://api.anthropic.com/v1',
        models: ['claude-sonnet-4-5', 'claude-opus-4-1'],
        defaultModel: 'claude-sonnet-4-5'
      },
      {
        id: 'gemini',
        kind: 'api',
        name: 'Google Gemini',
        protocol: 'gemini',
        enabled: false,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
        defaultModel: 'gemini-2.5-pro'
      },
      {
        id: 'moonshot',
        kind: 'api',
        name: '月之暗面 Kimi',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://api.moonshot.cn/v1',
        models: ['moonshot-v1-128k', 'kimi-k2'],
        defaultModel: 'moonshot-v1-128k'
      },
      {
        id: 'minimax',
        kind: 'api',
        name: 'MiniMax',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://api.minimax.chat/v1',
        models: ['MiniMax-M2', 'abab6.5s-chat'],
        defaultModel: 'MiniMax-M2'
      },
      {
        id: 'zhipu',
        kind: 'api',
        name: '智谱 GLM',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        models: ['glm-4.5', 'glm-4.5-air'],
        defaultModel: 'glm-4.5'
      },
      {
        id: 'qwen',
        kind: 'api',
        name: '通义千问',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        models: ['qwen-max', 'qwen-plus'],
        defaultModel: 'qwen-max'
      },
      {
        id: 'volcengine',
        kind: 'api',
        name: '火山方舟 / 豆包',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        models: ['doubao-seed-1.6', 'doubao-pro-32k'],
        defaultModel: 'doubao-seed-1.6'
      },
      {
        id: 'siliconflow',
        kind: 'api',
        name: '硅基流动',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://api.siliconflow.cn/v1',
        models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
        defaultModel: 'deepseek-ai/DeepSeek-V3'
      },
      {
        id: 'openrouter',
        kind: 'api',
        name: 'OpenRouter',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://openrouter.ai/api/v1',
        models: ['openai/gpt-5.1', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat'],
        defaultModel: 'openai/gpt-5.1'
      },
      {
        id: 'xai',
        kind: 'api',
        name: 'xAI / Grok',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://api.x.ai/v1',
        models: ['grok-4', 'grok-3-mini'],
        defaultModel: 'grok-4'
      },
      {
        id: 'mistral',
        kind: 'api',
        name: 'Mistral',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://api.mistral.ai/v1',
        models: ['mistral-large-latest', 'codestral-latest'],
        defaultModel: 'mistral-large-latest'
      }
    ],
    cli: [
      {
        id: 'claude-code',
        kind: 'cli',
        preset: 'claude-code',
        name: 'Claude Code',
        enabled: false,
        launchMode: 'cli',
        executable: 'claude',
        transport: 'stdio-jsonl',
        argsTemplate: '-p "{{prompt}}" --output-format stream-json',
        permissionFlags: {
          'auto-edit': '--permission-mode acceptEdits',
          smart: '--permission-mode default',
          'full-access': '--dangerously-skip-permissions'
        },
        cwdPolicy: 'workspace'
      },
      {
        id: 'codex',
        kind: 'cli',
        preset: 'codex',
        name: 'Codex CLI',
        enabled: false,
        launchMode: 'cli',
        executable: 'codex',
        transport: 'stdio-jsonl',
        argsTemplate: 'exec --cd {{workspace}} "{{prompt}}"',
        permissionFlags: { 'auto-edit': '--full-auto', smart: '--full-auto', 'full-access': '--full-auto' },
        cwdPolicy: 'workspace'
      },
      {
        id: 'opencode',
        kind: 'cli',
        preset: 'opencode',
        name: 'OpenCode',
        enabled: true,
        launchMode: 'cli',
        executable: 'opencode',
        transport: 'stdio-jsonl',
        argsTemplate: 'run --cwd {{workspace}} --model {{model}} "{{prompt}}"',
        permissionFlags: { ...FLAGS },
        cwdPolicy: 'workspace'
      },
      {
        id: 'paseo',
        kind: 'cli',
        preset: 'paseo',
        name: 'Paseo',
        enabled: false,
        launchMode: 'cli',
        executable: 'paseo',
        transport: 'acp',
        argsTemplate: '--workspace {{workspace}} "{{prompt}}"',
        permissionFlags: { ...FLAGS },
        cwdPolicy: 'workspace'
      },
      {
        id: 'cursor',
        kind: 'cli',
        preset: 'cursor',
        name: 'Cursor',
        enabled: false,
        launchMode: 'cli',
        executable: 'cursor-agent',
        transport: 'stdio-jsonl',
        argsTemplate: '--workspace {{workspace}} "{{prompt}}"',
        permissionFlags: { 'auto-edit': '--yolo', smart: '', 'full-access': '--yolo' },
        cwdPolicy: 'workspace'
      },
      {
        id: 'kimi-cli',
        kind: 'cli',
        preset: 'kimi-cli',
        name: 'Kimi CLI',
        enabled: false,
        launchMode: 'cli',
        executable: 'kimi',
        transport: 'stdio-jsonl',
        argsTemplate: '--workspace {{workspace}} "{{prompt}}"',
        permissionFlags: { 'auto-edit': '--auto', smart: '', 'full-access': '--auto' },
        cwdPolicy: 'workspace'
      },
      {
        id: 'qwen-code',
        kind: 'cli',
        preset: 'qwen-code',
        name: 'Qwen Code',
        enabled: false,
        launchMode: 'cli',
        executable: 'qwen',
        transport: 'stdio-jsonl',
        argsTemplate: '--workspace {{workspace}} "{{prompt}}"',
        permissionFlags: {
          'auto-edit': '--approval-mode yolo',
          smart: '',
          'full-access': '--approval-mode yolo'
        },
        cwdPolicy: 'workspace'
      },
      {
        id: 'devin',
        kind: 'cli',
        preset: 'devin',
        name: 'Devin',
        enabled: false,
        launchMode: 'cli',
        executable: 'devin',
        transport: 'oneshot-text',
        argsTemplate: 'run --workspace {{workspace}} "{{prompt}}"',
        permissionFlags: {
          'auto-edit': '--permission-mode bypass',
          smart: '',
          'full-access': '--permission-mode bypass --respect-workspace-trust false'
        },
        cwdPolicy: 'workspace'
      },
      {
        id: 'openclaw',
        kind: 'cli',
        preset: 'openclaw',
        name: 'OpenClaw',
        enabled: false,
        launchMode: 'cli',
        executable: 'openclaw',
        transport: 'stdio-jsonl',
        argsTemplate: '--prompt "{{prompt}}"',
        permissionFlags: { ...FLAGS },
        cwdPolicy: 'workspace'
      },
      {
        id: 'codebuddy',
        kind: 'cli',
        preset: 'codebuddy',
        name: 'CodeBuddy',
        enabled: false,
        launchMode: 'cli',
        executable: 'codebuddy',
        transport: 'stdio-jsonl',
        argsTemplate: '--prompt "{{prompt}}"',
        permissionFlags: {
          'auto-edit': '',
          smart: '',
          'full-access': '--dangerously-skip-permissions'
        },
        cwdPolicy: 'workspace'
      },
      {
        id: 'continue',
        kind: 'cli',
        preset: 'continue',
        name: 'Continue',
        enabled: false,
        launchMode: 'cli',
        executable: 'cn',
        transport: 'oneshot-text',
        argsTemplate: '-p "{{prompt}}"',
        permissionFlags: { 'auto-edit': '--allow "*"', smart: '', 'full-access': '--allow "*"' },
        cwdPolicy: 'workspace'
      },
      {
        id: 'mistral-vibe',
        kind: 'cli',
        preset: 'mistral-vibe',
        name: 'Mistral Vibe',
        enabled: false,
        launchMode: 'cli',
        executable: 'vibe',
        transport: 'oneshot-text',
        argsTemplate: '--prompt "{{prompt}}"',
        permissionFlags: {
          'auto-edit': '--agent auto-approve',
          smart: '',
          'full-access': '--agent auto-approve'
        },
        cwdPolicy: 'workspace'
      },
      {
        id: 'custom-command',
        kind: 'cli',
        preset: 'custom-command',
        name: 'Custom Command',
        enabled: false,
        launchMode: 'cli',
        executable: 'my-agent',
        transport: 'oneshot-text',
        argsTemplate: '--prompt "{{prompt}}"',
        permissionFlags: { 'auto-edit': '', smart: '', 'full-access': '' },
        cwdPolicy: 'custom',
        customCwd: ''
      }
    ],
    local: [
      {
        id: 'ollama',
        kind: 'local',
        name: 'Ollama',
        enabled: false,
        baseUrl: 'http://127.0.0.1:11434',
        models: ['llama3.1', 'qwen2.5'],
        numCtx: 8192,
        keepAliveMinutes: 30
      },
      {
        id: 'lm-studio',
        kind: 'local',
        name: 'LM Studio',
        enabled: false,
        baseUrl: 'http://127.0.0.1:1234/v1',
        models: ['local-model'],
        numCtx: 8192,
        keepAliveMinutes: 30
      },
      {
        id: 'vllm',
        kind: 'local',
        name: 'vLLM',
        enabled: false,
        baseUrl: 'http://127.0.0.1:8000/v1',
        models: ['meta-llama/Llama-3.1-8B-Instruct'],
        numCtx: 8192,
        keepAliveMinutes: 30
      }
    ],
    slots: {
      primaryModel: AUTO_ROUTE_MODEL,
      fastModel: 'deepseek-chat',
      plannerModel: 'deepseek-reasoner',
      embeddingModel: ''
    },
    browser: {
      driver: 'agent-browser-sandbox',
      cdpPort: 9222,
      perceptionMode: 'som-visual-hybrid',
      smartGateOnSubmit: true,
      rightPaneLivePreview: true,
      autoSolidifySkill: false
    }
  }
}


export function serializeModelServicesState(state: ModelServicesState): string {
  return JSON.stringify(state)
}

/**
 * 坏数据只回退到默认值，绝不让设置页白屏。
 *
 * 结果按原始字符串缓存：ChatPanel 每帧都会读一次状态，同一份 localStorage
 * 只解析一遍，输入与流式输出不再重复 JSON.parse 全量 sanitize。
 *
 * 缓存值是**共享**的，所以返回前整体冻结（对象、数组与每个条目）：
 * 任何原地 `push` / `sort` / `state.api[0].enabled = ...` 都会直接抛错，
 * 而不是静默污染同一份 localStorage 的所有读者。需要改状态请照
 * SettingsPage 的写法复制出新对象。不可变契约只靠注释挡不住，交给运行时。
 */
export function parseModelServicesState(raw: string | null): ModelServicesState {
  if (cachedRaw === raw && cachedState !== null) {
    return cachedState
  }
  const parsed = freezeDeep(parseModelServicesUncached(raw))
  cachedRaw = raw
  cachedState = parsed
  return parsed
}

let cachedRaw: string | null | undefined
let cachedState: ModelServicesState | null = null

function freezeDeep(state: ModelServicesState): ModelServicesState {
  for (const item of state.api) {
    Object.freeze(item)
    Object.freeze(item.models)
  }
  for (const item of state.cli) {
    Object.freeze(item)
    Object.freeze(item.permissionFlags)
  }
  for (const item of state.local) {
    Object.freeze(item)
    Object.freeze(item.models)
  }
  Object.freeze(state.api)
  Object.freeze(state.cli)
  Object.freeze(state.local)
  Object.freeze(state.slots)
  Object.freeze(state.browser)
  return Object.freeze(state)
}

function parseModelServicesUncached(raw: string | null): ModelServicesState {
  const base = createDefaultModelServicesState()
  if (!raw) {
    return base
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return base
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return base
  }
  const record = parsed as Record<string, unknown>
  const api = sanitizeApiList(record['api'])
  const cli = sanitizeCliList(record['cli'])
  const local = sanitizeLocalList(record['local'])
  const slots = record['slots']
  const browser = record['browser']
  return {
    api: mergePresets(api, base.api),
    cli: mergePresets(cli, base.cli),
    local: mergePresets(local, base.local),
    slots: {
      primaryModel: stringOf((slots as Record<string, unknown>)?.['primaryModel'], base.slots.primaryModel),
      fastModel: stringOf((slots as Record<string, unknown>)?.['fastModel'], base.slots.fastModel),
      plannerModel: stringOf(
        (slots as Record<string, unknown>)?.['plannerModel'],
        base.slots.plannerModel
      ),
      embeddingModel: stringOf(
        (slots as Record<string, unknown>)?.['embeddingModel'],
        base.slots.embeddingModel
      )
    },
    browser: sanitizeBrowser(browser, base.browser)
  }
}

function stringOf(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

/**
 * 老缓存增量合并：已有 id 保留用户改过的配置，新增预置按默认顺序补进来，
 * 自定义服务商（不在预置里）追加在末尾。
 *
 * 注意是**整条替换**（`byId.get(id) ?? item`），不是字段级合并：
 * 老条目缺的新字段只能靠 sanitize 的默认值兜，以后给预置加字段时记得
 * 在 sanitize 里给一个合理默认，否则老用户永远拿不到。
 */
function mergePresets<T extends { id: string }>(saved: T[], defaults: T[]): T[] {
  if (saved.length === 0) {
    return defaults
  }
  const byId = new Map(saved.map((item) => [item.id, item]))
  const known = new Set(defaults.map((item) => item.id))
  return [
    ...defaults.map((item) => byId.get(item.id) ?? item),
    ...saved.filter((item) => !known.has(item.id))
  ]
}

/** 自定义 API 服务商：id 从名称生成，重复时由 add 去重。 */
export function createCustomApiProvider(draft: {
  name: string
  baseUrl: string
  model?: string
}): ApiProviderProfile {
  const slug =
    draft.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'provider'
  const model = (draft.model ?? '').trim()
  return {
    id: `custom-${slug}`,
    kind: 'api',
    name: draft.name.trim() || '自定义服务商',
    protocol: 'openai-compatible',
    enabled: true,
    baseUrl: draft.baseUrl.trim(),
    models: model === '' ? [] : [model],
    defaultModel: model
  }
}

export function addCustomApiProvider(
  state: ModelServicesState,
  draft: { name: string; baseUrl: string; model?: string }
): ModelServicesState {
  const provider = createCustomApiProvider(draft)
  let id = provider.id
  let index = 2
  while (state.api.some((item) => item.id === id)) {
    id = `${provider.id}-${index}`
    index += 1
  }
  return { ...state, api: [...state.api, { ...provider, id }] }
}

/** 只允许删除自定义服务商；内置项只能停用。 */
export function removeCustomApiProvider(
  state: ModelServicesState,
  id: string
): ModelServicesState {
  if (!id.startsWith('custom-')) {
    return state
  }
  return { ...state, api: state.api.filter((item) => item.id !== id) }
}

function capabilityMap(value: unknown): Record<string, ModelCapabilitiesDto> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const out: Record<string, ModelCapabilitiesDto> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) {
      continue
    }
    const record = raw as Record<string, unknown>
    const efforts = Array.isArray(record['supportedEfforts'])
      ? record['supportedEfforts'].filter(
          (item): item is ReasoningEffortDto =>
            item === 'low' || item === 'mid' || item === 'high' || item === 'xhigh' || item === 'max'
        )
      : []
    const mode = record['effortMode']
    if (
      typeof record['supportsTools'] !== 'boolean' ||
      (mode !== 'none' && mode !== 'reasoning_effort' && mode !== 'thinking_budget' && mode !== 'fixed')
    ) {
      continue
    }
    out[key] = {
      supportsTools: record['supportsTools'],
      supportedEfforts: efforts,
      effortMode: mode
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  const out: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      out[key] = raw
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item !== '')
}

const API_PROTOCOLS: ApiProtocolKind[] = ['openai-compatible', 'deepseek', 'anthropic', 'gemini']
const CLI_PRESETS: CliEnginePresetId[] = [
  'opencode',
  'paseo',
  'devin',
  'claude-code',
  'codex',
  'cursor',
  'kimi-cli',
  'qwen-code',
  'openclaw',
  'codebuddy',
  'continue',
  'mistral-vibe',
  'custom-command'
]
const CLI_TRANSPORTS: CliTransportMode[] = ['stdio-jsonl', 'acp', 'oneshot-text']

function sanitizeApiList(value: unknown): ApiProviderProfile[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: ApiProviderProfile[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record['id'] !== 'string' || typeof record['name'] !== 'string') {
      continue
    }
    const protocol = API_PROTOCOLS.includes(record['protocol'] as ApiProtocolKind)
      ? (record['protocol'] as ApiProtocolKind)
      : 'openai-compatible'
    const models = stringList(record['models'])
    out.push({
      id: record['id'],
      kind: 'api',
      name: record['name'],
      protocol,
      enabled: record['enabled'] === true,
      baseUrl: stringOf(record['baseUrl'], ''),
      models,
      defaultModel: stringOf(record['defaultModel'], models[0] ?? ''),
      ...(typeof record['hasKey'] === 'boolean' ? { hasKey: record['hasKey'] } : {}),
      ...(typeof record['maskedKey'] === 'string' ? { maskedKey: record['maskedKey'] } : {}),
      ...(capabilityMap(record['modelCapabilities'])
        ? { modelCapabilities: capabilityMap(record['modelCapabilities']) }
        : {}),
      ...(stringMap(record['unselectableModels'])
        ? { unselectableModels: stringMap(record['unselectableModels']) }
        : {})
    })
  }
  return out
}

function sanitizeCliList(value: unknown): CliEngineProfile[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: CliEngineProfile[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const record = item as Record<string, unknown>
    if (typeof record['id'] !== 'string' || typeof record['name'] !== 'string') {
      continue
    }
    const preset = CLI_PRESETS.includes(record['preset'] as CliEnginePresetId)
      ? (record['preset'] as CliEnginePresetId)
      : 'custom-command'
    const transport = CLI_TRANSPORTS.includes(record['transport'] as CliTransportMode)
      ? (record['transport'] as CliTransportMode)
      : 'oneshot-text'
    const rawFlags =
      typeof record['permissionFlags'] === 'object' && record['permissionFlags'] !== null
        ? (record['permissionFlags'] as Record<string, unknown>)
        : {}
    out.push({
      id: record['id'],
      kind: 'cli',
      preset,
      name: record['name'],
      enabled: record['enabled'] === true,
      launchMode: record['launchMode'] === 'chat' ? 'chat' : 'cli',
      executable: stringOf(record['executable'], ''),
      transport,
      argsTemplate: stringOf(record['argsTemplate'], '{{prompt}}'),
      permissionFlags: {
        'auto-edit': stringOf(rawFlags['auto-edit'], ''),
        smart: stringOf(rawFlags['smart'], ''),
        'full-access': stringOf(rawFlags['full-access'], '')
      },
      cwdPolicy: record['cwdPolicy'] === 'custom' ? 'custom' : 'workspace',
      ...(typeof record['customCwd'] === 'string' ? { customCwd: record['customCwd'] } : {})
    })
  }
  return out
}

function sanitizeLocalList(value: unknown): LocalRuntimeProfile[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: LocalRuntimeProfile[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) {
      continue
    }
    const record = item as Record<string, unknown>
    if (
      record['id'] !== 'ollama' &&
      record['id'] !== 'lm-studio' &&
      record['id'] !== 'vllm'
    ) {
      continue
    }
    out.push({
      id: record['id'],
      kind: 'local',
      name: stringOf(record['name'], record['id']),
      enabled: record['enabled'] === true,
      baseUrl: stringOf(record['baseUrl'], ''),
      models: stringList(record['models']),
      numCtx: typeof record['numCtx'] === 'number' && record['numCtx'] > 0 ? record['numCtx'] : 8192,
      keepAliveMinutes:
        typeof record['keepAliveMinutes'] === 'number' && record['keepAliveMinutes'] >= 0
          ? record['keepAliveMinutes']
          : 30,
      ...(capabilityMap(record['modelCapabilities'])
        ? { modelCapabilities: capabilityMap(record['modelCapabilities']) }
        : {}),
      ...(stringMap(record['unselectableModels'])
        ? { unselectableModels: stringMap(record['unselectableModels']) }
        : {})
    })
  }
  return out
}

function sanitizeBrowser(
  value: unknown,
  fallback: AgentBrowserWorkflowConfig
): AgentBrowserWorkflowConfig {
  if (typeof value !== 'object' || value === null) {
    return fallback
  }
  const record = value as Record<string, unknown>
  return {
    driver:
      record['driver'] === 'local-cdp-attach' ? 'local-cdp-attach' : 'agent-browser-sandbox',
    cdpPort:
      typeof record['cdpPort'] === 'number' && record['cdpPort'] > 0
        ? record['cdpPort']
        : fallback.cdpPort,
    perceptionMode:
      record['perceptionMode'] === 'axtree-first' ? 'axtree-first' : 'som-visual-hybrid',
    smartGateOnSubmit:
      typeof record['smartGateOnSubmit'] === 'boolean'
        ? record['smartGateOnSubmit']
        : fallback.smartGateOnSubmit,
    rightPaneLivePreview:
      typeof record['rightPaneLivePreview'] === 'boolean'
        ? record['rightPaneLivePreview']
        : fallback.rightPaneLivePreview,
    autoSolidifySkill:
      typeof record['autoSolidifySkill'] === 'boolean'
        ? record['autoSolidifySkill']
        : fallback.autoSolidifySkill
  }
}

/** CLI 命令行预览：替换占位符，按三档权限拼标志，压掉多余空白。 */
export function buildCliInvocationPreview(
  profile: CliEngineProfile,
  options: {
    permissionMode: AgentPermissionMode
    workspace: string
    model?: string
    prompt: string
  }
): string {
  const mode = uiPermissionMode(options.permissionMode)
  const flag =
    profile.permissionFlags[mode as keyof CliEngineProfile['permissionFlags']] ?? ''
  // 模型为空时连 --model 一起剔除，别让 prompt 顶到模型位上
  let template = profile.argsTemplate
  if (!options.model) {
    template = template
      .replace(/--model\s+\{\{model\}\}/g, '')
      .replace(/--model=\{\{model\}\}/g, '')
  }
  const command = template
    .replaceAll('{{workspace}}', options.workspace)
    .replaceAll('{{model}}', options.model ?? '')
    .replaceAll('{{prompt}}', options.prompt)
  return [profile.executable, command, flag]
    .filter((part) => part.trim() !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 汇总所有已启用的 API / 本地模型与 CLI 引擎。 */
export function collectAvailableModelOptions(state: ModelServicesState): ModelOption[] {
  const collected: ModelOption[] = []

  for (const provider of state.api) {
    if (!provider.enabled) {
      continue
    }
    for (const model of provider.models) {
      collected.push({ value: model, label: model, kind: 'api' })
    }
  }

  for (const runtime of state.local) {
    if (!runtime.enabled) {
      continue
    }
    for (const model of runtime.models) {
      collected.push({ value: model, label: `${runtime.name} · ${model}`, kind: 'local' })
    }
  }

  for (const engine of state.cli) {
    if (!engine.enabled) {
      continue
    }
    collected.push({
      value: `cli:${engine.preset}`,
      label: `⚡ ${engine.name} · CLI 引擎`,
      kind: 'cli'
    })
  }

  // 跨服务商可能配同一个模型 id：按 value 去重，先出现的赢
  const seen = new Set<string>()
  return collected.filter((option) => {
    if (seen.has(option.value)) {
      return false
    }
    seen.add(option.value)
    return true
  })
}

/**
 * 模型位（新建智能体 / 四槽位 / 输入栏）可选的口径。
 *
 * 只列「主进程里已经配通」的服务商：请求只能覆盖 model，baseUrl / key 仍按
 * providerId 取，所以把没配 Key 的别家模型选进来只会失败。
 * CLI 引擎同样没有执行路径，`cli:xxx` 会被当成模型名发出去，也排除。
 *
 * readyProviderIds 来自 providers.listAccounts()（hasKey 或本地协议）。
 * 兼容传单个 id；null / 空数组时返回空，调用方只显示会话当前值。
 */
export function collectModelPositionOptions(
  state: ModelServicesState,
  readyProviderIds: string | readonly string[] | null
): ModelOption[] {
  const ready =
    readyProviderIds === null
      ? []
      : typeof readyProviderIds === 'string'
        ? [readyProviderIds]
        : [...readyProviderIds]
  if (ready.length === 0) {
    return []
  }

  const options: ModelOption[] = []
  for (const providerId of ready) {
    const api = state.api.find((item) => item.id === providerId)
    if (api) {
      for (const model of api.models) {
        options.push({
          value: model,
          label: model,
          kind: 'api',
          providerId,
          modelId: model
        })
      }
      continue
    }
    const runtime = state.local.find((item) => item.id === providerId)
    if (runtime) {
      for (const model of runtime.models) {
        options.push({
          value: model,
          label: `${runtime.name} · ${model}`,
          kind: 'local',
          providerId,
          modelId: model
        })
      }
    }
  }
  return options
}

/** 服务商显示名：目录里的中文名优先，未知 id 原样返回。 */
export function providerDisplayName(providerId: string, state: ModelServicesState): string {
  const api = state.api.find((item) => item.id === providerId)
  if (api) {
    return api.name
  }
  const local = state.local.find((item) => item.id === providerId)
  return local ? local.name : providerId
}

/** 某个模型标识在下拉里显示什么。 */
export function modelDisplayLabel(value: string, state: ModelServicesState): string {
  const found = collectAvailableModelOptions(state).find((option) => option.value === value)
  return found?.label ?? MODEL_LABEL[value] ?? value
}
