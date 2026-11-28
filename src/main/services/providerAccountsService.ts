// services/providerAccountsService —— 多服务商凭据的读写用例。
//
// 关键行为（每条都有测试守着）：
// 1. 按 providerId 增删改，保存 Ollama 不会覆盖 DeepSeek；
// 2. 只改地址/模型时，留空的 apiKey 沿用该家已保存的 Key；
// 3. 首次启动时若库为空且旧 provider.json 有记录，自动迁移一条；
// 4. 对外只给脱敏视图。
import {
  toAccountView,
  validateAccountDraft,
  protocolRequiresKey,
  type ProviderAccount,
  type ProviderAccountDraft,
  type ProviderAccountView
} from '../ai/domain/providerAccounts.ts'
import type { ProviderSettings } from '../ai/domain/providerSettings.ts'
import type { JsonFileStore } from '../data/fileStore.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface ProviderAccountsServiceDeps {
  now: () => string
  /** 旧版单行凭据：仅用于首次迁移。 */
  legacy?: { read(): Promise<ProviderSettings | null> }
}

export class ProviderAccountsService {
  private readonly store: JsonFileStore<ProviderAccount>
  private readonly deps: ProviderAccountsServiceDeps
  private migrated = false

  constructor(store: JsonFileStore<ProviderAccount>, deps: ProviderAccountsServiceDeps) {
    this.store = store
    this.deps = deps
  }

  /** 首次读取时把旧单行配置并入（只做一次，且只在库为空时）。 */
  private async load(): Promise<ProviderAccount[]> {
    const items = await this.store.readAll()
    if (this.migrated || items.length > 0 || !this.deps.legacy) {
      this.migrated = true
      return items
    }
    this.migrated = true
    const legacy = await this.deps.legacy.read()
    if (!legacy) {
      return items
    }
    const account: ProviderAccount = {
      id: legacy.id,
      protocol: legacy.id === 'ollama' ? 'ollama' : 'deepseek',
      apiKey: legacy.apiKey,
      baseUrl: legacy.baseUrl,
      defaultModel: legacy.model,
      ...(legacy.params ? { params: { ...legacy.params } } : {}),
      updatedAt: legacy.updatedAt
    }
    await this.store.writeAll([account])
    return [account]
  }

  /** 主进程内部使用：含明文 Key。 */
  async list(): Promise<ProviderAccount[]> {
    return [...(await this.load())]
  }

  async listMasked(): Promise<ProviderAccountView[]> {
    return (await this.load()).map(toAccountView)
  }

  async getInternal(providerId: string): Promise<ProviderAccount | null> {
    const items = await this.load()
    return items.find((item) => item.id === providerId) ?? null
  }

  /** 已经配通的服务商：本地协议免 Key，其余必须有 Key。 */
  async listReadyProviderIds(): Promise<string[]> {
    return (await this.load())
      .filter((item) => !protocolRequiresKey(item.protocol) || item.apiKey.trim() !== '')
      .map((item) => item.id)
  }

  async save(draft: ProviderAccountDraft): Promise<ServiceResult<ProviderAccount>> {
    const items = await this.load()
    const existing = items.find((item) => item.id === draft.providerId) ?? null
    const checked = validateAccountDraft(draft, existing?.apiKey ?? '')
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    const account: ProviderAccount = {
      ...checked.value,
      id: checked.value.providerId,
      updatedAt: this.deps.now()
    }
    const index = items.findIndex((item) => item.id === account.id)
    const next = index >= 0 ? items.map((item, i) => (i === index ? account : item)) : [...items, account]
    await this.store.writeAll(next)
    return { ok: true, value: account }
  }

  async clear(providerId: string): Promise<ServiceResult<true>> {
    const items = await this.load()
    const next = items.filter((item) => item.id !== providerId)
    await this.store.writeAll(next)
    return { ok: true, value: true }
  }
}
