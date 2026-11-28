// services/providerAccountsService —— 多服务商凭据的读写用例。
//
// 关键行为（每条都有测试守着）：
// 1. 按 providerId 增删改，保存 Ollama 不会覆盖 DeepSeek；
// 2. 只改地址/模型时，留空的 apiKey 沿用该家已保存的 Key；
// 3. 首次启动时若从未迁移过且旧 provider.json 有记录，自动迁移一条；
// 4. 用户主动清空账户后，重启不会把旧 provider.json 再迁回来；
// 5. 对外只给脱敏视图；并发首读共享同一次初始化。
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

/** 迁移哨兵：标记「这台机器已经做过一次旧配置迁移」。 */
export interface MigrationMarker {
  isDone(): Promise<boolean>
  markDone(): Promise<void>
}

export interface ProviderAccountsServiceDeps {
  now: () => string
  /** 旧版单行凭据：仅用于首次迁移。 */
  legacy?: { read(): Promise<ProviderSettings | null> }
  /**
   * 迁移标记。没有它时只能靠「账户数组非空」判断，用户清空账户后重启会被
   * 旧 provider.json 复活；生产环境必须注入（组合根用 .migrated 哨兵文件）。
   */
  migration?: MigrationMarker
}

export class ProviderAccountsService {
  private readonly store: JsonFileStore<ProviderAccount>
  private readonly deps: ProviderAccountsServiceDeps
  private loaded: ProviderAccount[] | null = null
  private loading: Promise<ProviderAccount[]> | null = null

  constructor(store: JsonFileStore<ProviderAccount>, deps: ProviderAccountsServiceDeps) {
    this.store = store
    this.deps = deps
  }

  private async init(): Promise<ProviderAccount[]> {
    const items = await this.store.readAll()
    // 库里已经有账户：说明迁移过或用户自己配过，绝对不能再迁。
    if (items.length > 0 || !this.deps.legacy) {
      return items
    }
    // 空库：先看迁移哨兵。用户主动清空后哨兵仍在，避免「清除凭据重启复活」。
    if (this.deps.migration && (await this.deps.migration.isDone())) {
      return items
    }
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
    await this.deps.migration?.markDone()
    return [account]
  }

  /** 首读只初始化一次；并发调用共享同一个 Promise，避免首帧拿到空数组。 */
  private async load(): Promise<ProviderAccount[]> {
    if (this.loaded !== null) {
      return this.loaded
    }
    if (this.loading === null) {
      this.loading = this.init()
    }
    const items = await this.loading
    this.loaded = items
    this.loading = null
    return items
  }

  /** 写操作后刷新内存快照，避免后续读拿到旧数组。 */
  private commit(items: ProviderAccount[]): void {
    this.loaded = items
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
    const next =
      index >= 0
        ? items.map((item, i) => (i === index ? account : item))
        : [...items, account]
    await this.store.writeAll(next)
    this.commit(next)
    return { ok: true, value: account }
  }

  async clear(providerId: string): Promise<ServiceResult<true>> {
    const items = await this.load()
    const next = items.filter((item) => item.id !== providerId)
    await this.store.writeAll(next)
    this.commit(next)
    return { ok: true, value: true }
  }
}
