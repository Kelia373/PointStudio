// ai/domain/providerAccounts —— 多服务商凭据的领域规则。
//
// 与旧的 providerSettings 的区别：那边是「一个平台一行」，切换即覆盖；
// 这里按 providerId 一家一条，互不影响。旧的 SETTINGS_CHANNELS 继续可用，
// 这里只负责新增的多账号库，不破坏旧契约。
//
// 红线：明文 Key 只存在于主进程运行时与 userData 文件里，对外一律脱敏。
import { maskApiKey } from './providerSettings.ts'

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

/** 实际发请求时走的线路协议。 */
export type ProviderWireProtocol =
  | 'openai-compatible'
  | 'deepseek'
  | 'opencode-go'
  | 'anthropic'
  | 'gemini'
  | 'ollama'

export const WIRE_PROTOCOLS: readonly ProviderWireProtocol[] = [
  'openai-compatible',
  'deepseek',
  'opencode-go',
  'anthropic',
  'gemini',
  'ollama'
]

export interface ProviderAccountParams {
  temperature?: number
  maxTokens?: number
  topP?: number
}

/** 持久化形态：一家服务商一条。 */
export interface ProviderAccount {
  id: string
  protocol: ProviderWireProtocol
  apiKey: string
  baseUrl: string
  defaultModel: string
  params?: ProviderAccountParams
  updatedAt: string
}

/** 用户输入形态；apiKey 留空表示沿用已保存的 Key。 */
export interface ProviderAccountDraft {
  providerId: string
  protocol?: ProviderWireProtocol
  apiKey?: string
  baseUrl: string
  defaultModel?: string
  params?: ProviderAccountParams
}

/** 对外视图：绝不含明文 Key。 */
export interface ProviderAccountView {
  providerId: string
  protocol: ProviderWireProtocol
  hasKey: boolean
  maskedKey: string
  baseUrl: string
  defaultModel: string
  params?: ProviderAccountParams
  updatedAt: string | null
}

/** 已知平台的默认值；未知 id 按自定义服务商处理。 */
export const KNOWN_PROVIDERS: Record<
  string,
  { protocol: ProviderWireProtocol; baseUrl: string; defaultModel: string }
> = {
  deepseek: {
    protocol: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat'
  },
  'opencode-go': {
    protocol: 'opencode-go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    defaultModel: 'kimi-k2.5'
  },
  ollama: { protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434', defaultModel: 'qwen2.5' }
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,48}$/

export function isProviderAccountId(value: unknown): value is string {
  return typeof value === 'string' && PROVIDER_ID_PATTERN.test(value)
}

const PARAM_LIMITS = {
  temperature: { min: 0, max: 2 },
  topP: { min: 0, max: 1 },
  maxTokens: { min: 1, max: 32_000 }
} as const

/** 本地协议不需要 Key，其余必须有。 */
export function protocolRequiresKey(protocol: ProviderWireProtocol): boolean {
  return protocol !== 'ollama'
}

export function isWireProtocol(value: unknown): value is ProviderWireProtocol {
  return typeof value === 'string' && (WIRE_PROTOCOLS as readonly string[]).includes(value)
}

function normalizeBaseUrl(raw: string): string {
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

function validateParams(raw: ProviderAccountParams | undefined): string[] {
  if (!raw) {
    return []
  }
  const errors: string[] = []
  for (const [key, limits] of Object.entries(PARAM_LIMITS)) {
    const value = raw[key as keyof ProviderAccountParams]
    if (value === undefined) {
      continue
    }
    if (!Number.isFinite(value) || value < limits.min || value > limits.max) {
      errors.push('E_PARAM_RANGE')
      break
    }
  }
  return errors
}

export interface ValidatedAccount {
  providerId: string
  protocol: ProviderWireProtocol
  apiKey: string
  baseUrl: string
  defaultModel: string
  params?: ProviderAccountParams
}

/**
 * @param draft 用户提交
 * @param existingApiKey 该 providerId 已保存的 Key：留空提交时沿用它
 */
export function validateAccountDraft(
  draft: ProviderAccountDraft,
  existingApiKey = ''
): Validation<ValidatedAccount> {
  const providerId = (draft.providerId ?? '').trim()
  if (!PROVIDER_ID_PATTERN.test(providerId)) {
    return { ok: false, errors: ['E_PROVIDER_UNSUPPORTED'] }
  }

  const known = KNOWN_PROVIDERS[providerId]
  const protocol = draft.protocol ?? known?.protocol ?? 'openai-compatible'
  if (!isWireProtocol(protocol)) {
    return { ok: false, errors: ['E_PROVIDER_UNSUPPORTED'] }
  }

  const errors: string[] = []
  const suppliedKey = (draft.apiKey ?? '').trim()
  // 只有同一家的 Key 才能沿用，避免把别家的凭据写进这条记录。
  const apiKey = suppliedKey !== '' ? suppliedKey : existingApiKey.trim()
  if (protocolRequiresKey(protocol) && apiKey === '') {
    errors.push('E_KEY_REQUIRED')
  }

  const baseUrl = normalizeBaseUrl(draft.baseUrl || known?.baseUrl || '')
  if (!isValidBaseUrl(baseUrl)) {
    errors.push('E_BASE_URL_INVALID')
  }

  const defaultModel = (draft.defaultModel ?? '').trim() || known?.defaultModel || ''
  errors.push(...validateParams(draft.params))

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return {
    ok: true,
    value: {
      providerId,
      protocol,
      apiKey,
      baseUrl,
      defaultModel,
      ...(draft.params ? { params: { ...draft.params } } : {})
    }
  }
}

/** 对外视图：脱敏 Key，不带明文。 */
export function toAccountView(account: ProviderAccount): ProviderAccountView {
  return {
    providerId: account.id,
    protocol: account.protocol,
    hasKey: account.apiKey !== '',
    maskedKey: maskApiKey(account.apiKey),
    baseUrl: account.baseUrl,
    defaultModel: account.defaultModel,
    ...(account.params ? { params: { ...account.params } } : {}),
    updatedAt: account.updatedAt
  }
}
