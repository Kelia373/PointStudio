// services/assistantService —— 助手的增删改查用例。
//
// 只依赖两样注入进来的东西：仓储（存哪由外面决定）和 id / 时钟（测试里可固定）。
// 禁止自己 new 文件路径、禁止 import electron —— 这是能被企业版原样复用的前提。
import {
  buildAssistant,
  validateAssistantDraft,
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

  async list(): Promise<Assistant[]> {
    return this.store.readAll()
  }

  async get(id: string): Promise<Assistant | null> {
    const items = await this.store.readAll()
    return items.find((item) => item.id === id) ?? null
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
      updatedAt: this.deps.now()
    }
    items[index] = updated
    await this.store.writeAll(items)
    return { ok: true, value: updated }
  }

  async remove(id: string): Promise<ServiceResult<true>> {
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
