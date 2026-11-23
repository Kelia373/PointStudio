// ai/domain/providerSettings —— 模型凭据的领域规则。
//
// 这一层决定三件事：什么算合法配置、对外怎么脱敏、多个来源之间谁优先。
// 不读写文件、不碰 electron；密钥本身只在运行时使用，永远不写进日志与仓库。
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL
} from '../providers/deepseek.ts'

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export const DEFAULT_PROVIDER_ID = 'deepseek'
export const DEFAULT_BASE_URL = DEEPSEEK_DEFAULT_BASE_URL
export const DEFAULT_MODEL = DEEPSEEK_DEFAULT_MODEL

/** 持久化形态：只存一个平台（当前只有 DeepSeek），换平台时按 id 区分。 */
export interface ProviderSettings {
  id: string
  apiKey: string
  baseUrl: string
  model: string
  updatedAt: string
}

/** 用户输入形态，允许只改其中几项。 */
export interface ProviderSettingsDraft {
  apiKey: string
  baseUrl?: string
  model?: string
}

/** 对外视图：绝不含明文 Key。 */
export interface ProviderSettingsView {
  hasKey: boolean
  maskedKey: string
  baseUrl: string
  model: string
  updatedAt: string | null
}

export interface ResolvedProviderConfig {
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
  apiKey: string
  baseUrl: string
  model: string
}> {
  const errors: string[] = []
  const apiKey = (draft.apiKey ?? '').trim() || currentApiKey.trim()
  if (apiKey === '') {
    errors.push('E_KEY_REQUIRED')
  }

  const baseUrl = normalizeBaseUrl(draft.baseUrl ?? DEFAULT_BASE_URL)
  if (!isValidBaseUrl(baseUrl)) {
    errors.push('E_BASE_URL_INVALID')
  }

  const model = (draft.model ?? '').trim() || DEFAULT_MODEL

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, value: { apiKey, baseUrl, model } }
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
  settings: { apiKey: string; baseUrl: string; model: string } | null,
  env: { apiKey?: string | null; baseUrl?: string | null; model?: string | null }
): ResolvedProviderConfig {
  const settingsKey = settings?.apiKey?.trim() ?? ''
  if (settingsKey !== '') {
    return {
      apiKey: settingsKey,
      baseUrl: settings?.baseUrl || DEFAULT_BASE_URL,
      model: settings?.model || DEFAULT_MODEL,
      source: 'settings'
    }
  }

  const envKey = env.apiKey?.trim() ?? ''
  if (envKey !== '') {
    return {
      apiKey: envKey,
      baseUrl: env.baseUrl?.trim() || DEFAULT_BASE_URL,
      model: env.model?.trim() || DEFAULT_MODEL,
      source: 'env'
    }
  }

  return {
    apiKey: null,
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    source: 'none'
  }
}
