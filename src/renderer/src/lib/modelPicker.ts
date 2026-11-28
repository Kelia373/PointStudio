// lib/modelPicker —— 模型选择浮层的纯数据层（排序 / 过滤 / 能力 / 输入栏策略）。
//
// 渲染层不 import 主进程：能力画像优先用 fetchModels 缓存的真实结果；
// 没缓存时用这里同构的规则表兜底（与 main/ai/providers/modelCapabilities 对齐，
// 两处都有测试钉住；新增模型族时两边一起改）。
import type {
  ModelCapabilitiesDto,
  ProviderAccountViewDto,
  ReasoningEffortDto
} from '../../../shared/types/ipc.ts'
import type {
  ApiProviderProfile,
  LocalRuntimeProfile,
  ModelServicesState
} from './modelServices.ts'

export const EFFORT_DISPLAY_ORDER: readonly ReasoningEffortDto[] = [
  'low',
  'mid',
  'high',
  'xhigh',
  'max'
]

export const EFFORT_SHORT_LABEL: Record<ReasoningEffortDto, string> = {
  low: 'Low',
  mid: 'Med',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max'
}

export interface PickerModel {
  id: string
  capabilities: ModelCapabilitiesDto
  /** 不可直选的原因；null 表示可选。 */
  disabledReason: string | null
}

export interface PickerProvider {
  providerId: string
  name: string
  protocol: string
  ready: boolean
  /** 该来源是否支持「拉取模型」（本地运行时也支持 Ollama）。 */
  supported: boolean
  models: PickerModel[]
}

const THREE: ReasoningEffortDto[] = ['low', 'mid', 'high']
const FIVE: ReasoningEffortDto[] = ['low', 'mid', 'high', 'xhigh', 'max']

function hasAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

/** 与主进程规则表对齐的兜底推断；只在没有 fetchModels 缓存时使用。 */
export function inferRendererCapabilities(
  providerId: string,
  modelId: string
): ModelCapabilitiesDto {
  const id = modelId.toLowerCase()
  const none: ModelCapabilitiesDto = {
    supportsTools: true,
    supportedEfforts: [],
    effortMode: 'none'
  }

  if (hasAny(id, ['embed', 'rerank'])) {
    return { supportsTools: false, supportedEfforts: [], effortMode: 'none' }
  }
  if (id.startsWith('deepseek')) {
    return hasAny(id, ['reasoner', 'r1'])
      ? { supportsTools: true, supportedEfforts: [], effortMode: 'fixed' }
      : none
  }
  if (/^(o1|o3|o4)(-|$)/.test(id) || id.startsWith('gpt-5') || id.includes('codex')) {
    const wide = /gpt-5\.[2-9]/.test(id) || id.includes('codex')
    return {
      supportsTools: true,
      supportedEfforts: wide ? ['low', 'mid', 'high', 'xhigh'] : [...THREE],
      effortMode: 'reasoning_effort'
    }
  }
  if (id.includes('claude')) {
    return { supportsTools: true, supportedEfforts: [...FIVE], effortMode: 'thinking_budget' }
  }
  if (id.includes('gemini-2.5') || id.startsWith('gemini-3')) {
    return { supportsTools: true, supportedEfforts: [...THREE], effortMode: 'reasoning_effort' }
  }
  if (hasAny(id, ['thinking', 'qwq', 'z1']) || /(^|[-_/])r1([-_/]|$)/.test(id)) {
    return {
      supportsTools: true,
      supportedEfforts: [...THREE],
      effortMode: providerId === 'opencode-go' ? 'thinking_budget' : 'reasoning_effort'
    }
  }
  return none
}

export function isProviderReady(account: ProviderAccountViewDto | undefined): boolean {
  if (!account) {
    return false
  }
  return account.hasKey || account.protocol === 'ollama'
}

function modelsOf(provider: ApiProviderProfile | LocalRuntimeProfile): PickerModel[] {
  const unselectable = provider.unselectableModels ?? {}
  // 不可直选的模型不在 provider.models 里，但必须继续显示（灰显 + 原因）。
  const ids = [...provider.models, ...Object.keys(unselectable)]
  return ids.map((id) => ({
    id,
    capabilities:
      provider.modelCapabilities?.[id] ?? inferRendererCapabilities(provider.id, id),
    disabledReason: unselectable[id] ?? null
  }))
}

/**
 * 来源轨排序：已配通（hasKey 或本地协议）在前，其余在后；
 * 同组内保持目录顺序，保证同一份数据每次渲染顺序稳定。
 */
export function sortPickerProviders(
  services: ModelServicesState,
  accounts: readonly ProviderAccountViewDto[]
): PickerProvider[] {
  const byId = new Map(accounts.map((account) => [account.providerId, account]))

  const api: PickerProvider[] = services.api.map((provider) => {
    const account = byId.get(provider.id)
    return {
      providerId: provider.id,
      name: provider.name,
      protocol: provider.protocol,
      ready: isProviderReady(account),
      supported: true,
      models: modelsOf(provider)
    }
  })
  const local: PickerProvider[] = services.local.map((runtime) => {
    const account = byId.get(runtime.id)
    return {
      providerId: runtime.id,
      name: runtime.name,
      protocol: 'ollama',
      ready: isProviderReady(account),
      supported: runtime.id === 'ollama',
      models: modelsOf(runtime)
    }
  })

  const all = [...api, ...local]
  return [...all.filter((item) => item.ready), ...all.filter((item) => !item.ready)]
}

/** 大小写不敏感子串过滤；空查询原样返回。 */
export function filterPickerModels(models: readonly PickerModel[], query: string): PickerModel[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') {
    return [...models]
  }
  return models.filter((model) => model.id.toLowerCase().includes(needle))
}

/** 优先读拉取缓存；没有就按规则表推断。 */
const OPENAI_LINE_EFFORTS: readonly ReasoningEffortDto[] = ['low', 'mid', 'high']

/**
 * OpenAI 兼容线只认 low/medium/high：UI 也只展示这三档，避免「亮了但发不出去」。
 * 其它协议（opencode-go 的 Anthropic 线、deepseek、本地）保持模型真实档位。
 */
function visibleEfforts(
  protocol: string,
  caps: ModelCapabilitiesDto
): ModelCapabilitiesDto {
  if (protocol !== 'openai-compatible') {
    return caps
  }
  return {
    ...caps,
    supportedEfforts: caps.supportedEfforts.filter((effort) =>
      OPENAI_LINE_EFFORTS.includes(effort)
    )
  }
}

export function resolvePickerModelCapabilities(
  services: ModelServicesState,
  providerId: string,
  modelId: string
): ModelCapabilitiesDto {
  const api = services.api.find((item) => item.id === providerId)
  const local = services.local.find((item) => item.id === providerId)
  const caps =
    api?.modelCapabilities?.[modelId] ??
    local?.modelCapabilities?.[modelId] ??
    inferRendererCapabilities(providerId, modelId)
  // OpenCode Go 自带双线路（Claude 走 Anthropic 线），不受 OpenAI 三档限制。
  const protocol = providerId === 'opencode-go' ? 'opencode-go' : (api?.protocol ?? 'ollama')
  return visibleEfforts(protocol, caps)
}

/**
 * 拉取结果写回目录：模型列表、能力缓存、不可选原因一起更新；
 * 当前默认模型不在新列表里时回落到第一个可选模型（没有就留空）。
 */
export function mergeDiscoveredIntoServices(
  services: ModelServicesState,
  providerId: string,
  discovered: readonly {
    id: string
    selectable: boolean
    note?: string
    capabilities?: ModelCapabilitiesDto
  }[]
): ModelServicesState {
  const selectable = discovered.filter((item) => item.selectable).map((item) => item.id)
  const unselectable: Record<string, string> = {}
  const capabilities: Record<string, ModelCapabilitiesDto> = {}
  for (const item of discovered) {
    if (!item.selectable) {
      unselectable[item.id] = item.note ?? '不可直选'
    }
    const caps = item.capabilities ?? inferRendererCapabilities(providerId, item.id)
    // 与主进程 capabilitiesForSelectable 对齐：不可直选的模型降级为无工具、不可调档。
    capabilities[item.id] = item.selectable
      ? caps
      : { ...caps, supportsTools: false, supportedEfforts: [] }
  }

  const hasUnselectable = Object.keys(unselectable).length > 0
  const api = services.api.map((provider) =>
    provider.id === providerId
      ? {
          ...provider,
          models: selectable,
          defaultModel: selectable.includes(provider.defaultModel)
            ? provider.defaultModel
            : (selectable[0] ?? ''),
          modelCapabilities: capabilities,
          ...(hasUnselectable ? { unselectableModels: unselectable } : {})
        }
      : provider
  )
  const local = services.local.map((runtime) =>
    runtime.id === providerId
      ? {
          ...runtime,
          models: selectable,
          modelCapabilities: capabilities,
          ...(hasUnselectable ? { unselectableModels: unselectable } : {})
        }
      : runtime
  )
  return { ...services, api, local }
}

export type ComposerModelPolicy =
  | { mode: 'locked-group'; label: string }
  | { mode: 'locked-agent'; canOpenAgentSettings: true }
  | { mode: 'editable' }

/** 从会话字段直接得到策略：只有会话级 groupId 才算小组聊天。 */
export function resolveConversationComposerPolicy(input: {
  assistantId: string | null
  groupId?: string | null
}): ComposerModelPolicy {
  return resolveComposerModelPolicy({
    assistantId: input.assistantId,
    inGroup: input.groupId != null
  })
}

/** 输入栏能不能换模型：小组锁死、绑定 Agent 锁死、自由对话才可编辑。 */
export function resolveComposerModelPolicy(input: {
  assistantId: string | null
  inGroup: boolean
}): ComposerModelPolicy {
  if (input.inGroup) {
    return { mode: 'locked-group', label: '各成员独立模型' }
  }
  if (input.assistantId !== null) {
    return { mode: 'locked-agent', canOpenAgentSettings: true }
  }
  return { mode: 'editable' }
}
