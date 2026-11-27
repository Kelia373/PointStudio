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
  const record = parsed as Partial<ModelServicesState>
  return {
    api: Array.isArray(record.api) && record.api.length > 0 ? record.api : base.api,
    cli: Array.isArray(record.cli) && record.cli.length > 0 ? record.cli : base.cli,
    local: Array.isArray(record.local) && record.local.length > 0 ? record.local : base.local,
    slots: { ...base.slots, ...(record.slots ?? {}) },
    browser: { ...base.browser, ...(record.browser ?? {}) }
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
  const command = profile.argsTemplate
    .replaceAll('{{workspace}}', options.workspace)
    .replaceAll('{{model}}', options.model ?? '')
    .replaceAll('{{prompt}}', options.prompt)
  return [profile.executable, command, flag]
    .filter((part) => part.trim() !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 汇总所有已启用的 API / 本地模型与 CLI 引擎，供各处下拉消费。 */
export function collectAvailableModelOptions(state: ModelServicesState): ModelOption[] {
  const options: ModelOption[] = []

  for (const provider of state.api) {
    if (!provider.enabled) {
      continue
    }
    for (const model of provider.models) {
      options.push({ value: model, label: model, kind: 'api' })
    }
  }

  for (const runtime of state.local) {
    if (!runtime.enabled) {
      continue
    }
    for (const model of runtime.models) {
      options.push({ value: model, label: `${runtime.name} · ${model}`, kind: 'local' })
    }
  }

  for (const engine of state.cli) {
    if (!engine.enabled) {
      continue
    }
    options.push({
      value: `cli:${engine.preset}`,
      label: `⚡ ${engine.name} · CLI 引擎`,
      kind: 'cli'
    })
  }

  return options
}

/** 某个模型标识在下拉里显示什么。 */
export function modelDisplayLabel(value: string, state: ModelServicesState): string {
  const found = collectAvailableModelOptions(state).find((option) => option.value === value)
  return found?.label ?? MODEL_LABEL[value] ?? value
}
