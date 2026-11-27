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
export type ApiProtocolKind = 'openai-compatible' | 'deepseek' | 'anthropic' | 'gemini'
export type CliEnginePresetId =
  | 'opencode'
  | 'paseo'
  | 'devin'
  | 'claude-code'
  | 'codex'
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
}

export interface CliEngineProfile {
  id: string
  kind: 'cli'
  preset: CliEnginePresetId
  name: string
  enabled: boolean
  executable: string
  transport: CliTransportMode
  argsTemplate: string
  permissionFlags: Record<'auto-edit' | 'smart' | 'full-access', string>
  cwdPolicy: 'workspace' | 'custom'
  customCwd?: string
}

export interface LocalRuntimeProfile {
  id: 'ollama' | 'lm-studio'
  kind: 'local'
  name: string
  enabled: boolean
  baseUrl: string
  models: string[]
  numCtx: number
  keepAliveMinutes: number
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
}

const FLAGS = {
  'auto-edit': '--allow-edits',
  smart: '--smart-approve',
  'full-access': '--dangerously-skip-permissions'
} as const

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
        id: 'siliconflow',
        kind: 'api',
        name: 'OpenAI 兼容 / SiliconFlow',
        protocol: 'openai-compatible',
        enabled: false,
        baseUrl: 'https://api.siliconflow.cn/v1',
        models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'],
        defaultModel: 'deepseek-ai/DeepSeek-V3'
      },
      {
        id: 'anthropic',
        kind: 'api',
        name: 'Anthropic',
        protocol: 'anthropic',
        enabled: false,
        baseUrl: 'https://api.anthropic.com/v1',
        models: ['claude-sonnet-4-5', 'claude-opus-4-1'],
        defaultModel: 'claude-sonnet-4-5'
      },
      {
        id: 'gemini',
        kind: 'api',
        name: 'Gemini',
        protocol: 'gemini',
        enabled: false,
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        models: ['gemini-2.5-pro', 'gemini-2.5-flash'],
        defaultModel: 'gemini-2.5-pro'
      }
    ],
    cli: [
      {
        id: 'opencode',
        kind: 'cli',
        preset: 'opencode',
        name: 'OpenCode',
        enabled: true,
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
        executable: 'paseo',
        transport: 'acp',
        argsTemplate: '--workspace {{workspace}} --model {{model}} --prompt "{{prompt}}"',
        permissionFlags: { ...FLAGS },
        cwdPolicy: 'workspace'
      },
      {
        id: 'devin',
        kind: 'cli',
        preset: 'devin',
        name: 'Devin',
        enabled: false,
        executable: 'devin',
        transport: 'oneshot-text',
        argsTemplate: 'run --workspace {{workspace}} "{{prompt}}"',
        permissionFlags: { ...FLAGS },
        cwdPolicy: 'workspace'
      },
      {
        id: 'claude-code',
        kind: 'cli',
        preset: 'claude-code',
        name: 'Claude Code',
        enabled: false,
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
        executable: 'codex',
        transport: 'stdio-jsonl',
        argsTemplate: 'exec --cd {{workspace}} "{{prompt}}"',
        permissionFlags: { ...FLAGS },
        cwdPolicy: 'workspace'
      },
      {
        id: 'custom-command',
        kind: 'cli',
        preset: 'custom-command',
        name: 'Custom Command',
        enabled: false,
        executable: 'command',
        transport: 'oneshot-text',
        argsTemplate: '{{prompt}}',
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

/** 坏数据只回退到默认值，绝不让设置页白屏。 */
export function parseModelServicesState(raw: string | null): ModelServicesState {
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
    api: api.length > 0 ? api : base.api,
    cli: cli.length > 0 ? cli : base.cli,
    local: local.length > 0 ? local : base.local,
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
      ...(typeof record['maskedKey'] === 'string' ? { maskedKey: record['maskedKey'] } : {})
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
    if (record['id'] !== 'ollama' && record['id'] !== 'lm-studio') {
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
          : 30
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
 * 模型位（新建智能体 / 四槽位 / 输入栏）可选的口径：
 * CLI 引擎还没有执行路径，选成模型只会把 `cli:xxx` 发给 API，所以这里排除。
 */
export function collectModelPositionOptions(state: ModelServicesState): ModelOption[] {
  return collectAvailableModelOptions(state).filter((option) => option.kind !== 'cli')
}

/** 某个模型标识在下拉里显示什么。 */
export function modelDisplayLabel(value: string, state: ModelServicesState): string {
  const found = collectAvailableModelOptions(state).find((option) => option.value === value)
  return found?.label ?? MODEL_LABEL[value] ?? value
}
