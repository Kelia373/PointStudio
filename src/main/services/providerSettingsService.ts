// services/providerSettingsService —— 模型凭据的读写用例。
//
// 存一个就够（当前只有 DeepSeek），所以整存整取：每次 save 都覆盖成单条，
// 避免历史配置越积越多、还要判断「哪条生效」。
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_PROVIDER_ID,
  maskApiKey,
  validateSettings,
  type ProviderSettings,
  type ProviderSettingsDraft,
  type ProviderSettingsView
} from '../ai/domain/providerSettings.ts'
import type { JsonFileStore } from '../data/fileStore.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface ProviderSettingsServiceDeps {
  now: () => string
}

export class ProviderSettingsService {
  private readonly store: JsonFileStore<ProviderSettings>
  private readonly deps: ProviderSettingsServiceDeps

  constructor(store: JsonFileStore<ProviderSettings>, deps: ProviderSettingsServiceDeps) {
    this.store = store
    this.deps = deps
  }

  /** 运行时读取：含明文 Key，只给主进程内部用，绝不跨进程传出。 */
  async read(): Promise<ProviderSettings | null> {
    const items = await this.store.readAll()
    return items[0] ?? null
  }

  /** 跨进程视图：只有脱敏 Key，供界面显示「已配置 / 未配置」。 */
  async readMasked(): Promise<ProviderSettingsView> {
    const current = await this.read()
    if (!current) {
      return {
        hasKey: false,
        maskedKey: '',
        baseUrl: DEFAULT_BASE_URL,
        model: DEFAULT_MODEL,
        updatedAt: null
      }
    }
    return {
      hasKey: current.apiKey !== '',
      maskedKey: maskApiKey(current.apiKey),
      baseUrl: current.baseUrl,
      model: current.model,
      updatedAt: current.updatedAt
    }
  }

  async save(draft: ProviderSettingsDraft): Promise<ServiceResult<ProviderSettings>> {
    const current = await this.read()
    const checked = validateSettings(draft, current?.apiKey ?? '')
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    const settings: ProviderSettings = {
      id: DEFAULT_PROVIDER_ID,
      ...checked.value,
      updatedAt: this.deps.now()
    }
    await this.store.writeAll([settings])
    return { ok: true, value: settings }
  }

  async clear(): Promise<ServiceResult<true>> {
    await this.store.writeAll([])
    return { ok: true, value: true }
  }
}
