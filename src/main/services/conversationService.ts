// services/conversationService —— 会话与消息的用例。
//
// 两个集合（会话、消息）分开存：消息会长得很快，混在一个文件里每次写都要
// 重写全部消息。级联关系（删会话连消息）由本层负责，存储层只管整存整取。
import {
  DEFAULT_CONVERSATION_TITLE,
  deriveTitle,
  isMessageRole,
  validateConversationParams,
  validateMessageContent,
  validateModelId,
  validateProviderId,
  validateTitle,
  type Conversation,
  type ConversationParams,
  type Message,
  type MessageReference,
  type MessageRole,
  type MessageStatus
} from '../ai/domain/conversation.ts'
import type { JsonFileStore } from '../data/fileStore.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface ConversationServiceDeps {
  newId: () => string
  now: () => string
}

export interface CreateConversationInput {
  title?: string
  assistantId?: string | null
  workspaceId?: string | null
  groupId?: string | null
  isHome?: boolean
}

export interface AppendMessageInput {
  role: MessageRole
  content: string
  status?: MessageStatus
  /** 可选：本次回答引用了哪些片段。 */
  references?: MessageReference[]
  /** 模型深度思考内容；只在非空时落盘。 */
  reasoning?: string
  reasoningMs?: number
}

export class ConversationService {
  private readonly conversations: JsonFileStore<Conversation>
  private readonly messages: JsonFileStore<Message>
  private readonly deps: ConversationServiceDeps

  constructor(
    conversations: JsonFileStore<Conversation>,
    messages: JsonFileStore<Message>,
    deps: ConversationServiceDeps
  ) {
    this.conversations = conversations
    this.messages = messages
    this.deps = deps
  }

  /** 按最近活动倒序——界面左栏的顺序就是它。 */
  async list(): Promise<Conversation[]> {
    const items = await this.conversations.readAll()
    return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async get(id: string): Promise<Conversation | null> {
    const items = await this.conversations.readAll()
    return items.find((item) => item.id === id) ?? null
  }

  async create(input: CreateConversationInput = {}): Promise<ServiceResult<Conversation>> {
    // 主聊天必须挂在某个 Agent 上，且不能是小组会话。
    if (input.isHome === true && (typeof input.assistantId !== 'string' || input.assistantId === '' || input.groupId != null)) {
      return { ok: false, errors: ['E_BAD_INPUT'] }
    }
    let title = DEFAULT_CONVERSATION_TITLE
    if (input.title !== undefined) {
      const checked = validateTitle(input.title)
      if (!checked.ok) {
        return { ok: false, errors: checked.errors }
      }
      title = checked.value
    }

    const now = this.deps.now()
    const conversation: Conversation = {
      id: this.deps.newId(),
      title,
      assistantId: input.assistantId ?? null,
      workspaceId: input.workspaceId ?? null,
      groupId: input.groupId ?? null,
      ...(input.isHome === true ? { isHome: true } : {}),
      createdAt: now,
      updatedAt: now
    }

    const items = await this.conversations.readAll()
    if (input.isHome === true) {
      // 同一 Agent 只保留一条主聊天：旧主聊天降级为专题会话，消息不动。
      for (const item of items) {
        if (item.assistantId === input.assistantId) {
          delete item.isHome
        }
      }
    }
    items.push(conversation)
    await this.conversations.writeAll(items)
    return { ok: true, value: conversation }
  }

  async rename(id: string, title: string): Promise<ServiceResult<Conversation>> {
    const checked = validateTitle(title)
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    const items = await this.conversations.readAll()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    const updated: Conversation = {
      ...items[index],
      title: checked.value,
      updatedAt: this.deps.now()
    }
    items[index] = updated
    await this.conversations.writeAll(items)
    return { ok: true, value: updated }
  }

  /** 绑定（或解绑）助手。assistantId 为 null 表示退回裸对话。 */
  async setAssistant(id: string, assistantId: string | null): Promise<ServiceResult<Conversation>> {
    const items = await this.conversations.readAll()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    const previous = items[index]
    const updated: Conversation = {
      ...previous,
      assistantId,
      updatedAt: this.deps.now()
    }
    // 换绑 / 解绑后不再属于原 Agent，主聊天标记必须清掉，避免悬挂。
    if (previous.assistantId !== assistantId) {
      delete updated.isHome
    }
    items[index] = updated
    await this.conversations.writeAll(items)
    return { ok: true, value: updated }
  }

  /** 删会话必须连它的消息一起删，否则会留下永远读不到的孤儿数据。 */
  /**
   * 设置会话级模型与采样参数。
   * 传 undefined 表示「这一项不动」，传 null 表示「清掉覆盖、跟随默认」。
   */
  async setModel(
    id: string,
    patch: { model?: string | null; providerId?: string | null; params?: ConversationParams }
  ): Promise<ServiceResult<Conversation>> {
    const items = await this.conversations.readAll()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    const next: Conversation = { ...items[index], updatedAt: this.deps.now() }
    // 换服务商却没指定新模型时，旧模型很可能不属于新家，清掉避免漂移。
    if (
      patch.providerId !== undefined &&
      (patch.providerId ?? null) !== (items[index].providerId ?? null) &&
      patch.model === undefined
    ) {
      delete next.model
    }

    if (patch.model !== undefined) {
      const model = validateModelId(patch.model)
      if (!model.ok) {
        return { ok: false, errors: [model.error] }
      }
      if (model.value === null) {
        delete next.model
      } else {
        next.model = model.value
      }
    }

    if (patch.providerId !== undefined) {
      const provider = validateProviderId(patch.providerId)
      if (!provider.ok) {
        return { ok: false, errors: [provider.error] }
      }
      if (provider.value === null) {
        delete next.providerId
      } else {
        next.providerId = provider.value
      }
    }

    if (patch.params !== undefined) {
      const params = validateConversationParams(patch.params)
      if (!params.ok) {
        return { ok: false, errors: [params.error] }
      }
      if (Object.keys(params.value).length === 0) {
        delete next.params
      } else {
        next.params = params.value
      }
    }

    items[index] = next
    await this.conversations.writeAll(items)
    return { ok: true, value: next }
  }

  async remove(id: string): Promise<ServiceResult<true>> {
    const items = await this.conversations.readAll()
    const index = items.findIndex((item) => item.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    items.splice(index, 1)
    await this.conversations.writeAll(items)

    const messages = await this.messages.readAll()
    await this.messages.writeAll(messages.filter((message) => message.conversationId !== id))
    return { ok: true, value: true }
  }

  async listMessages(conversationId: string): Promise<Message[]> {
    const messages = await this.messages.readAll()
    return messages.filter((message) => message.conversationId === conversationId)
  }

  async appendMessage(
    conversationId: string,
    input: AppendMessageInput
  ): Promise<ServiceResult<Message>> {
    if (!isMessageRole(input.role)) {
      return { ok: false, errors: ['E_BAD_ROLE'] }
    }
    const checked = validateMessageContent(input.content)
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    const conversations = await this.conversations.readAll()
    const index = conversations.findIndex((item) => item.id === conversationId)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    const now = this.deps.now()
    const message: Message = {
      id: this.deps.newId(),
      conversationId,
      role: input.role,
      content: checked.value,
      status: input.status ?? 'complete',
      // 空数组也存成 undefined：旧数据没有这个字段，保持形状一致才好比较与迁移。
      ...(input.references && input.references.length > 0
        ? { references: input.references.map((item) => ({ ...item })) }
        : {}),
      ...(input.reasoning && input.reasoning !== '' ? { reasoning: input.reasoning } : {}),
      ...(typeof input.reasoningMs === 'number' && input.reasoningMs >= 0
        ? { reasoningMs: input.reasoningMs }
        : {}),
      createdAt: now,
      updatedAt: now
    }

    const messages = await this.messages.readAll()
    messages.push(message)
    await this.messages.writeAll(messages)

    // 标题只在「还是默认标题」且收到用户第一句话时生成，之后不再动它。
    const shouldDeriveTitle =
      conversations[index].title === DEFAULT_CONVERSATION_TITLE &&
      input.role === 'user' &&
      conversations[index].isHome !== true
    conversations[index] = {
      ...conversations[index],
      title: shouldDeriveTitle ? deriveTitle(checked.value) : conversations[index].title,
      updatedAt: now
    }
    await this.conversations.writeAll(conversations)

    return { ok: true, value: message }
  }

  async updateMessage(id: string, content: string): Promise<ServiceResult<Message>> {
    const checked = validateMessageContent(content)
    if (!checked.ok) {
      return { ok: false, errors: checked.errors }
    }

    const messages = await this.messages.readAll()
    const index = messages.findIndex((message) => message.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    const updated: Message = {
      ...messages[index],
      content: checked.value,
      updatedAt: this.deps.now()
    }
    messages[index] = updated
    await this.messages.writeAll(messages)
    return { ok: true, value: updated }
  }

  async removeMessage(id: string): Promise<ServiceResult<true>> {
    const messages = await this.messages.readAll()
    const index = messages.findIndex((message) => message.id === id)
    if (index < 0) {
      return { ok: false, errors: ['E_NOT_FOUND'] }
    }

    messages.splice(index, 1)
    await this.messages.writeAll(messages)
    return { ok: true, value: true }
  }
}
