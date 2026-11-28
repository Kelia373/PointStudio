// ai/providers/modelCapabilities —— 模型能力的真实画像（拒绝假档位）。
//
// 优先采信上游 /models 返回的元数据；只有裸 ID 时按官方模型族规则推导。
// 这里不猜「能不能调思考强度」以外的东西：supportsTools 只影响界面灰标。
import type {
  EffortWireModeDto,
  ModelCapabilitiesDto,
  ReasoningEffortDto
} from '../../../shared/types/ipc.ts'

export const REASONING_EFFORTS: readonly ReasoningEffortDto[] = [
  'low',
  'mid',
  'high',
  'xhigh',
  'max'
]

const THREE: ReasoningEffortDto[] = ['low', 'mid', 'high']
const FIVE: ReasoningEffortDto[] = ['low', 'mid', 'high', 'xhigh', 'max']

function hasAny(haystack: string, needles: readonly string[]): boolean {
  return needles.some((needle) => haystack.includes(needle))
}

/** 上游 supported_parameters（OpenRouter 风格）里出现这些，才认为支持调档。 */
function metadataEfforts(raw: Record<string, unknown>): ReasoningEffortDto[] | null {
  const params = raw['supported_parameters']
  if (!Array.isArray(params)) {
    return null
  }
  const list = params.filter((item): item is string => typeof item === 'string')
  if (list.includes('reasoning_effort')) {
    return THREE
  }
  if (list.includes('thinking') || list.includes('reasoning')) {
    return THREE
  }
  if (list.includes('include_reasoning')) {
    return []
  }
  return null
}

function metadataTools(raw: Record<string, unknown>): boolean | null {
  const params = raw['supported_parameters']
  if (Array.isArray(params)) {
    const list = params.filter((item): item is string => typeof item === 'string')
    if (list.includes('tools') || list.includes('tool_choice')) {
      return true
    }
  }
  if (raw['tools'] === false) {
    return false
  }
  return null
}

/**
 * 规则表只覆盖已知模型族；命中不了就诚实返回「不可调档、不带工具」。
 * providerId 用来区分同名模型的线路（例如 Claude 走 Anthropic 线）。
 */
export function inferModelCapabilities(
  providerId: string,
  modelId: string,
  raw?: Record<string, unknown>
): ModelCapabilitiesDto {
  const id = modelId.toLowerCase()
  const vision = inferVision(id, raw)

  if (raw) {
    const efforts = metadataEfforts(raw)
    const tools = metadataTools(raw)
    const reasoningOff = raw['reasoning'] === false
    if (reasoningOff) {
      return {
        supportsTools: tools ?? true,
        supportedEfforts: [],
        effortMode: 'none',
        ...(vision === null ? {} : { supportsVision: vision })
      }
    }
    if (efforts !== null) {
      return {
        supportsTools: tools ?? true,
        supportedEfforts: efforts,
        effortMode:
          providerId === 'opencode-go' || raw['thinking'] !== undefined
            ? 'thinking_budget'
            : 'reasoning_effort',
        ...(vision === null ? {} : { supportsVision: vision })
      }
    }
  }

  // 嵌入模型没有对话能力，也不该出现在模型位；这里给最保守的画像。
  if (hasAny(id, ['embed', 'rerank'])) {
    return {
      supportsTools: false,
      supportedEfforts: [],
      effortMode: 'none',
      supportsVision: false
    }
  }

  // DeepSeek：chat 不支持调档；reasoner 固定开思考。两者都不吃图。
  if (id.startsWith('deepseek')) {
    if (hasAny(id, ['reasoner', 'r1'])) {
      return {
        supportsTools: true,
        supportedEfforts: [],
        effortMode: 'fixed',
        supportsVision: false
      }
    }
    return {
      supportsTools: true,
      supportedEfforts: [],
      effortMode: 'none',
      supportsVision: false
    }
  }

  // OpenAI 推理族：o1 / o3 / o4 / gpt-5。gpt-5.2+ 与 codex 多一档 xhigh。
  if (
    /^(o1|o3|o4)(-|$)/.test(id) ||
    id.startsWith('gpt-5') ||
    id.includes('codex')
  ) {
    const wide = /gpt-5\.[2-9]/.test(id) || id.includes('codex')
    return {
      supportsTools: true,
      supportedEfforts: wide ? ['low', 'mid', 'high', 'xhigh'] : THREE,
      effortMode: 'reasoning_effort',
      ...(vision === null ? {} : { supportsVision: vision })
    }
  }

  // Claude 3.7 / 4 系：Anthropic 的 thinking budget 五档。
  if (id.includes('claude')) {
    return {
      supportsTools: true,
      supportedEfforts: [...FIVE],
      effortMode: 'thinking_budget',
      supportsVision: vision ?? true
    }
  }

  // Gemini 2.5 / 3：reasoning_effort 三档。
  if (id.includes('gemini-2.5') || id.startsWith('gemini-3')) {
    return {
      supportsTools: true,
      supportedEfforts: [...THREE],
      effortMode: 'reasoning_effort',
      supportsVision: vision ?? true
    }
  }

  // 国内推理变体：kimi thinking / qwen qwq / glm z1。走 OpenAI 兼容线。
  if (
    hasAny(id, ['thinking', 'qwq', 'z1']) ||
    /(^|[-_/])r1([-_/]|$)/.test(id)
  ) {
    return {
      supportsTools: true,
      supportedEfforts: [...THREE],
      effortMode: providerId === 'opencode-go' ? 'thinking_budget' : 'reasoning_effort',
      ...(vision === null ? {} : { supportsVision: vision })
    }
  }

  // 其余普通模型：能带工具，但不能调思考强度。
  return {
    supportsTools: true,
    supportedEfforts: [],
    effortMode: 'none',
    ...(vision === null ? {} : { supportsVision: vision })
  }
}

/** 明确不吃图的模型族：命中就硬拦，不把图发出去白烧一次配额。 */
const TEXT_ONLY = [
  'deepseek-chat',
  'deepseek-reasoner',
  'deepseek-coder',
  'qwq',
  'o1-mini',
  'o3-mini'
]

/** 已知能吃图的模型族。 */
const VISION_FAMILIES = [
  'gpt-4o',
  'gpt-4.1',
  'gpt-5',
  'o1',
  'o3',
  'o4-mini',
  'claude-3',
  'claude-sonnet-4',
  'claude-opus-4',
  'gemini',
  'kimi-k2.5',
  'qwen-vl',
  'qwen2.5-vl',
  'qwen3-vl',
  'glm-4v',
  'pixtral',
  'llava',
  'minicpm-v',
  'gemma3'
]

/**
 * 视觉能力画像：上游元数据优先，其次裸 ID 规则，最后 undefined（未知放行）。
 * 未知就返回 null 而不是 false——自定义模型别被规则误杀。
 */
function inferVision(id: string, raw?: Record<string, unknown>): boolean | null {
  const declared = metadataVision(raw)
  if (declared !== null) {
    return declared
  }
  if (TEXT_ONLY.some((family) => id === family || id.startsWith(`${family}-`))) {
    return false
  }
  if (hasAny(id, ['-vision', 'vision-', 'vl-', '-vl', 'omni'])) {
    return true
  }
  if (VISION_FAMILIES.some((family) => id === family || id.startsWith(`${family}-`) || id.startsWith(family))) {
    return true
  }
  return null
}

/** 上游元数据：architecture.modality / input_modalities 里有没有 image。 */
function metadataVision(raw: Record<string, unknown> | undefined): boolean | null {
  if (!raw) {
    return null
  }
  const architecture = raw['architecture']
  if (typeof architecture === 'object' && architecture !== null) {
    const modality = (architecture as Record<string, unknown>)['modality']
    if (typeof modality === 'string') {
      return modality.includes('image')
    }
  }
  const inputs = raw['input_modalities']
  if (Array.isArray(inputs)) {
    const values = inputs.filter((item): item is string => typeof item === 'string')
    if (values.length > 0) {
      return values.includes('image')
    }
  }
  return null
}

/** 只有 upsteam 明确标了 -free 之类不可直选时，工具能力才降级。 */
export function capabilitiesForSelectable(
  capabilities: ModelCapabilitiesDto,
  selectable: boolean
): ModelCapabilitiesDto {
  return selectable
    ? capabilities
    : { ...capabilities, supportsTools: false, supportedEfforts: [] }
}

/**
 * 最近一次 discovery 拉回的真实能力（按 providerId → modelId）。
 * 发送侧优先读它：否则「上游声明支持、但规则表不认识的模型」会出现
 * UI 亮档位却不发参数的情况。
 */
const discoveredCapabilities = new Map<string, Map<string, ModelCapabilitiesDto>>()

export function rememberModelCapabilities(
  providerId: string,
  models: readonly { id: string; capabilities?: ModelCapabilitiesDto }[]
): void {
  const bucket = new Map<string, ModelCapabilitiesDto>()
  for (const model of models) {
    if (model.capabilities) {
      bucket.set(model.id, model.capabilities)
    }
  }
  discoveredCapabilities.set(providerId, bucket)
}

export function capabilitiesForSend(
  providerId: string,
  modelId: string
): ModelCapabilitiesDto {
  return (
    discoveredCapabilities.get(providerId)?.get(modelId) ??
    inferModelCapabilities(providerId, modelId)
  )
}

export type { EffortWireModeDto }
