// services/assistantService —— 助手的增删改查用例。
//
// 只依赖两样注入进来的东西：仓储（存哪由外面决定）和 id / 时钟（测试里可固定）。
// 禁止自己 new 文件路径、禁止 import electron —— 这是能被企业版原样复用的前提。
import {
  buildAssistant,
  validateAssistantDraft,
  DEFAULT_ASSISTANT_ID,
  DEFAULT_ASSISTANT_NAME,
  type Assistant,
  type AssistantDraft
} from '../ai/domain/assistant.ts'
import type { JsonFileStore } from '../data/fileStore.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface AssistantServiceDeps {
  newId: () => string
  now: () => string
}

export class AssistantService {
  private readonly store: JsonFileStore<Assistant>
  private readonly deps: AssistantServiceDeps

  constructor(store: JsonFileStore<Assistant>, deps: AssistantServiceDeps) {
    this.store = store
    this.deps = deps
  }

  /** 内置通用助手恒排第一；其余保持存储顺序，不按时间重排。 */
  async list(): Promise<Assistant[]> {
    const items = await this.store.readAll()
    const builtin = items.filter((item) => item.builtin === true || item.id === DEFAULT_ASSISTANT_ID)
    if (builtin.length === 0) {
      return items
    }
    return [...builtin, ...items.filter((item) => !builtin.includes(item))]
  }

  async get(id: string): Promise<Assistant | null> {
    const items = await this.store.readAll()
    return items.find((item) => item.id === id) ?? null
  }

  /**
   * 幂等确保内置「通用助手」存在。
   *
   * 已存在时绝不覆盖用户改过的名字 / 模型 / 提示词，只补 `builtin: true` 标记——
   * 否则每启动一次就会把用户配置洗回默认值。
   */
  async ensureBuiltin(): Promise<Assistant> {
    const items = await this.store.readAll()
    const index = items.findIndex((item) => item.id === DEFAULT_ASSISTANT_ID)

    if (index >= 0) {
      const current = items[index]
      if (current.builtin === true) {
        return current
      }
      const marked: Assistant = { ...current, builtin: true }
      items[index] = marked
      await this.store.writeAll(items)
      return marked
    }

    const now = this.deps.now()
    const created: Assistant = {
      id: DEFAULT_ASSISTANT_ID,
      name: DEFAULT_ASSISTANT_NAME,
      // 空提示词 = 不注入人设，等价于和原生模型直聊。
      systemPrompt: '',
      providerId: null,
      modelId: null,
      params: { temperature: 0.7, maxTokens: 2048, topP: 1 },
      enabled: true,
      permissionMode: 'smart',
      avatar: null,
      builtin: true,
      createdAt: now,
      updatedAt: now
    }
    items.push(created)
    await this.store.writeAll(items)
    return created
  }

  async create(draft: AssistantDraft): Promise<ServiceResult<Assistant>> {
    const checked = validateAssistantDraft(draft)
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    const assistant = buildAssistant(draft, { id: this.deps.newId(), now: this.deps.now() })
    const items = await this.store.readAll()
    items.push(assistant)
    await this.store.writeAll(items)
    return { ok: true, value: assistant }
  }

  async update(id: string, draft: AssistantDraft): Promise<ServiceResult<Assistant>> {
    const checked = validateAssistantDraft(draft)
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    const items = await this.store.readAll()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    // 内置通用助手：可以改名、换模型、加提示词，但不能被停用——
    // 它一旦停用，所有收编过来的历史会话就没有归属了。
    if (id === DEFAULT_ASSISTANT_ID && checked.value.enabled === false) {
      return { ok: false, errors: ['E_BUILTIN_PROTECTED'] }
    }

    // 更新是「整条替换」，所以没传的 enabled 必须先填回原值——
    // 否则在那张只有名字和提示词的编辑表单里保存一次，停用状态就被悄悄清掉了。
    const merged: AssistantDraft = {
      ...draft,
      enabled: draft.enabled ?? items[index].enabled ?? true,
      // 局部改名 / 启停时，权限模式与头像不能被洗掉
      permissionMode: draft.permissionMode ?? items[index].permissionMode ?? 'smart',
      avatar: draft.avatar !== undefined ? draft.avatar : (items[index].avatar ?? null)
    }

    // id 与 createdAt 属于身份，不允许被一次更新改掉。
    const rebuilt = buildAssistant(merged, { id, now: this.deps.now() })
    const updated: Assistant = {
      ...rebuilt,
      createdAt: items[index].createdAt,
      updatedAt: this.deps.now(),
      // 内置标记不能被一次整条替换洗掉。
      ...(id === DEFAULT_ASSISTANT_ID || items[index].builtin === true
        ? { builtin: true }
        : {})
    }
    items[index] = updated
    await this.store.writeAll(items)
    return { ok: true, value: updated }
  }

  async remove(id: string): Promise<ServiceResult<true>> {
    if (id === DEFAULT_ASSISTANT_ID) {
      return { ok: false, errors: ['E_BUILTIN_PROTECTED'] }
    }

    const items = await this.store.readAll()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    items.splice(index, 1)
    await this.store.writeAll(items)
    return { ok: true, value: true }
  }
}
