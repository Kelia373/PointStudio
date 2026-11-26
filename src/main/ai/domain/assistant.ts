// ai/domain/assistant —— 助手（角色）的领域模型与校验。
//
// 约束：零 IO、零 electron、零 react。校验规则写在这里，是因为它属于业务规则，
// 不属于边界（ipc）也不属于存储（data）。企业版复用同一份规则，行为才对等。

export interface ModelParams {
  temperature: number
  maxTokens: number
  topP: number
}

export interface Assistant {
  id: string
  name: string
  systemPrompt: string
  /** 绑定的 provider；null 表示用全局默认。 */
  providerId: string | null
  /** 绑定的模型；null 表示用全局默认。 */
  modelId: string | null
  params: ModelParams
  /** 停用后不参与派发。旧数据可能没有这个字段（视为启用）。 */
  enabled?: boolean
  createdAt: string
  updatedAt: string
}

/** 用户输入（来自界面），字段可缺省。 */
export interface AssistantDraft {
  name: string
  /** 省略表示「不动」：新建按启用，更新时由服务层填回原值。 */
  enabled?: boolean
  systemPrompt?: string
  providerId?: string | null
  modelId?: string | null
  params?: Partial<ModelParams>
}

export interface AssistantInput {
  name: string
  enabled: boolean
  systemPrompt: string
  providerId: string | null
  modelId: string | null
  params: ModelParams
}

export type ValidationResult =
  | { ok: true; value: AssistantInput }
  | { ok: false; errors: string[] }

export const DEFAULT_PARAMS: ModelParams = Object.freeze({
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1
})

export const NAME_MAX_LENGTH = 60
export const MAX_TOKENS_LIMIT = 32_000

function normalizeParams(raw: Partial<ModelParams> | undefined): ModelParams {
  return {
    temperature: raw?.temperature ?? DEFAULT_PARAMS.temperature,
    maxTokens: raw?.maxTokens ?? DEFAULT_PARAMS.maxTokens,
    topP: raw?.topP ?? DEFAULT_PARAMS.topP
  }
}

function paramsInRange(params: ModelParams): boolean {
  const { temperature, maxTokens, topP } = params
  return (
    Number.isFinite(temperature) &&
    temperature >= 0 &&
    temperature <= 2 &&
    Number.isFinite(topP) &&
    topP >= 0 &&
    topP <= 1 &&
    Number.isInteger(maxTokens) &&
    maxTokens >= 1 &&
    maxTokens <= MAX_TOKENS_LIMIT
  )
}

/**
 * 校验并归一化用户输入。错误用错误码表达（稳定契约），不返回给人看的文案——
 * 文案属于 i18n，会变；错误码不会。
 */
export function validateAssistantDraft(draft: AssistantDraft): ValidationResult {
  const errors: string[] = []
  const name = (draft.name ?? '').trim()

  if (name === '') {
    errors.push('E_NAME_REQUIRED')
  } else if (Array.from(name).length > NAME_MAX_LENGTH) {
    errors.push('E_NAME_TOO_LONG')
  }

  const params = normalizeParams(draft.params)
  if (!paramsInRange(params)) {
    errors.push('E_PARAM_RANGE')
  }

  // enabled 只认布尔：'false' 这种字符串一旦混进去，「停用」会变成永远不生效
  if (draft.enabled !== undefined && typeof draft.enabled !== 'boolean') {
    errors.push('E_ENABLED_INVALID')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      name,
      enabled: draft.enabled ?? true,
      systemPrompt: draft.systemPrompt ?? '',
      providerId: draft.providerId ?? null,
      modelId: draft.modelId ?? null,
      params
    }
  }
}

/** 构造实体。先校验再构造，非法输入直接抛错，不生成半成品。 */
export function buildAssistant(
  draft: AssistantDraft,
  context: { id: string; now: string }
): Assistant {
  const checked = validateAssistantDraft(draft)
  if (!checked.ok) {
    throw new Error(`E_INVALID_ASSISTANT: ${checked.errors.join(',')}`)
  }
  return {
    id: context.id,
    ...checked.value,
    // 每次都给新对象：共享同一个 params 引用，改一个助手会串改另一个。
    params: { ...checked.value.params },
    createdAt: context.now,
    updatedAt: context.now
  }
}
