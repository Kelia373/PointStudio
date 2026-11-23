// ai/domain/providerSettings —— 模型凭据的领域规则。
//
// 这一层决定三件事：什么算合法配置、对外怎么脱敏、多个来源之间谁优先。
// 不读写文件、不碰 electron；密钥本身只在运行时使用，永远不写进日志与仓库。
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL
} from '../providers/deepseek.ts'
import { OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL } from '../providers/ollama.ts'

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export type ProviderId = 'deepseek' | 'ollama'

export const PROVIDER_IDS: readonly ProviderId[] = ['deepseek', 'ollama']
export const DEFAULT_PROVIDER_ID: ProviderId = 'deepseek'
export const DEFAULT_BASE_URL = DEEPSEEK_DEFAULT_BASE_URL
export const DEFAULT_MODEL = DEEPSEEK_DEFAULT_MODEL

/** 每个平台的默认值，以及是否必须有凭据。新增平台只加一行。 */
export const PROVIDER_DEFAULTS: Record<
  ProviderId,
  { baseUrl: string; model: string; requiresApiKey: boolean }
> = {
  deepseek: { baseUrl: DEEPSEEK_DEFAULT_BASE_URL, model: DEEPSEEK_DEFAULT_MODEL, requiresApiKey: true },
  ollama: { baseUrl: OLLAMA_DEFAULT_BASE_URL, model: OLLAMA_DEFAULT_MODEL, requiresApiKey: false }
}

/** 持久化形态：只存一个平台（当前只有 DeepSeek），换平台时按 id 区分。 */
export interface ProviderSettings {
  id: ProviderId
  apiKey: string
  baseUrl: string
  model: string
  /** 采样参数；没填过就是 undefined，不凭空造默认值。 */
  params?: ProviderParams
  updatedAt: string
}

/** 与助手的 ModelParams 同区间，避免两套规则打架。 */
export interface ProviderParams {
  temperature?: number
  maxTokens?: number
  topP?: number
}

const PARAM_LIMITS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  maxTokens: { min: 1, max: 32_000 }
} as const

function validateParams(raw: ProviderParams | undefined): string[] {
  if (!raw) {
    return []
  }
  const errors: string[] = []
  const { temperature, topP, maxTokens } = raw

  if (temperature !== undefined) {
    const { min, max } = PARAM_LIMITS.temperature
    if (!Number.isFinite(temperature) || temperature < min || temperature > max) {
      errors.push('E_PARAM_RANGE')
    }
  }
  if (topP !== undefined) {
    const { min, max } = PARAM_LIMITS.topP
    if (!Number.isFinite(topP) || topP < min || topP > max) {
      errors.push('E_PARAM_RANGE')
    }
  }
  if (maxTokens !== undefined) {
    const { min, max } = PARAM_LIMITS.maxTokens
    if (!Number.isInteger(maxTokens) || maxTokens < min || maxTokens > max) {
      errors.push('E_PARAM_RANGE')
    }
  }
  return errors
}

/** 用户输入形态，允许只改其中几项。 */
export interface ProviderSettingsDraft {
  providerId?: ProviderId
  apiKey?: string
  baseUrl?: string
  model?: string
  params?: ProviderParams
}

/** 对外视图：绝不含明文 Key。 */
export interface ProviderSettingsView {
  providerId: ProviderId
  params: ProviderParams
  hasKey: boolean
  maskedKey: string
  baseUrl: string
  model: string
  updatedAt: string | null
}

export interface ResolvedProviderConfig {
  providerId: ProviderId
  params?: ProviderParams
  apiKey: string | null
  baseUrl: string
  model: string
  source: 'settings' | 'env' | 'none'
}

function normalizeBaseUrl(raw: string): string {
  // 末尾斜杠必须去掉，否则拼出来是 https://x///chat/completions。
  return raw.trim().replace(/\/+$/, '')
}

function isValidBaseUrl(candidate: string): boolean {
  if (candidate === '') {
    return false
  }
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/**
 * @param draft 用户提交的输入
 * @param currentApiKey 已保存的 Key：留空提交时沿用它，这样「只改模型」不会把凭据弄丢
 */
export function validateSettings(
  draft: ProviderSettingsDraft,
  currentApiKey = ''
): Validation<{
  providerId: ProviderId
  apiKey: string
  baseUrl: string
  model: string
  params?: ProviderParams
}> {
  const errors: string[] = []
  const providerId = (draft.providerId ?? DEFAULT_PROVIDER_ID) as ProviderId
  if (!PROVIDER_IDS.includes(providerId)) {
    return { ok: false, errors: ['E_PROVIDER_UNSUPPORTED'] }
  }

  const defaults = PROVIDER_DEFAULTS[providerId]
  const apiKey = (draft.apiKey ?? '').trim() || (providerId === DEFAULT_PROVIDER_ID ? currentApiKey.trim() : '')
  if (defaults.requiresApiKey && apiKey === '') {
    errors.push('E_KEY_REQUIRED')
  }

  const baseUrl = normalizeBaseUrl(draft.baseUrl ?? defaults.baseUrl)
  if (!isValidBaseUrl(baseUrl)) {
    errors.push('E_BASE_URL_INVALID')
  }

  const model = (draft.model ?? '').trim() || defaults.model

  const paramErrors = validateParams(draft.params)
  errors.push(...paramErrors)

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    value: {
      providerId,
      apiKey,
      baseUrl,
      model,
      ...(draft.params ? { params: { ...draft.params } } : {})
    }
  }
}

/**
 * 脱敏：只露头 4 位与尾 4 位。短 Key 全遮——露头尾反而更容易被猜。
 * 这不是加密，只是防止界面/日志里出现完整凭据。
 */
export function maskApiKey(apiKey: string): string {
  if (apiKey === '') {
    return ''
  }
  if (apiKey.length <= 8) {
    return '****'
  }
  return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`
}

/**
 * 优先级：已保存的设置 > 环境变量 > 默认值。
 *
 * 设置优先是因为它是用户在界面里显式配置的；环境变量是开发期的兜底手段
 * （既能免去每次手填，也保证「没配任何东西」时仍然能跑通本地假流式）。
 */
export function resolveProviderConfig(
  settings: {
    id: ProviderId
    apiKey: string
    baseUrl: string
    model: string
    params?: ProviderParams
  } | null,
  env: { apiKey?: string | null; baseUrl?: string | null; model?: string | null }
): ResolvedProviderConfig {
  if (settings) {
    // 免凭据的平台（本地模型）只要配置过就算生效；需要凭据的平台必须有 Key。
    const requiresKey = PROVIDER_DEFAULTS[settings.id]?.requiresApiKey ?? true
    const usable = requiresKey ? settings.apiKey.trim() !== '' : true
    if (usable) {
      const defaults = PROVIDER_DEFAULTS[settings.id]
      return {
        providerId: settings.id,
        ...(settings.params ? { params: settings.params } : {}),
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl || defaults.baseUrl,
        model: settings.model || defaults.model,
        source: 'settings'
      }
    }
  }

  const envKey = env.apiKey?.trim() ?? ''
  if (envKey !== '') {
    return {
      providerId: DEFAULT_PROVIDER_ID,
      apiKey: envKey,
      baseUrl: env.baseUrl?.trim() || DEFAULT_BASE_URL,
      model: env.model?.trim() || DEFAULT_MODEL,
      source: 'env'
    }
  }

  return {
    providerId: DEFAULT_PROVIDER_ID,
    apiKey: null,
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    source: 'none'
  }
}
