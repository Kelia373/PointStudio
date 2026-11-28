// services/turnService —— 消息级的「整轮」操作。
//
// 为什么单独一层：删除一条用户消息却不删它的回答，会留下一段没有问题的
// 孤零零的答复；这种数据在导出、备份、回放时都很难解释。
//
// 规则：
// - 删用户消息 → 连带它之后、下一条用户消息之前的助手回复（即「这一轮」）；
// - 删助手消息 → 只删这一条（提问保留，用户可以重发）；
// - 找不到 → E_NOT_FOUND，一条都不动。
import { TITLE_MAX_LENGTH, type Conversation, type Message } from '../ai/domain/conversation.ts'
import type { ConversationService } from './conversationService.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface DeleteTurnResult {
  removed: number
}

export async function deleteTurn(
  conversations: ConversationService,
  conversationId: string,
  messageId: string
): Promise<ServiceResult<DeleteTurnResult>> {
  const messages = await conversations.listMessages(conversationId)
  const index = messages.findIndex((message) => message.id === messageId)
  if (index < 0) {
    return { ok: false, errors: ['E_NOT_FOUND'] }
  }

  const targets: Message[] = [messages[index]]

  if (messages[index].role === 'user') {
    // 收集「这一轮」剩下的消息：直到下一条用户消息为止。
    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      if (messages[cursor].role === 'user') {
        break
      }
      targets.push(messages[cursor])
    }
  }

  let removed = 0
  for (const target of targets) {
    const result = await conversations.removeMessage(target.id)
    if (result.ok) {
      removed += 1
    }
  }

  return { ok: true, value: { removed } }
}

/** 读出一条消息的文本（用于「复制」）。只读，不改数据。 */
export async function copyMessageText(
  conversations: ConversationService,
  conversationId: string,
  messageId: string
): Promise<string | null> {
  const messages = await conversations.listMessages(conversationId)
  return messages.find((message) => message.id === messageId)?.content ?? null
}


/** 删除 fromMessageId 及其后的全部消息（编辑重发前先裁剪）。 */
export async function truncateFrom(
  conversations: ConversationService,
  conversationId: string,
  fromMessageId: string
): Promise<ServiceResult<DeleteTurnResult>> {
  const messages = await conversations.listMessages(conversationId)
  const index = messages.findIndex((message) => message.id === fromMessageId)
  if (index < 0) {
    return { ok: false, errors: ['E_NOT_FOUND'] }
  }
  let removed = 0
  for (const message of messages.slice(index)) {
    const result = await conversations.removeMessage(message.id)
    if (result.ok) {
      removed += 1
    }
  }
  return { ok: true, value: { removed } }
}

export interface BranchConversationInput {
  conversationId: string
  upToMessageId: string
  title?: string
}

function branchTitle(sourceTitle: string): string {
  const combined = `分支 · ${sourceTitle}`
  const chars = Array.from(combined)
  return chars.length > TITLE_MAX_LENGTH ? chars.slice(0, TITLE_MAX_LENGTH).join('') : combined
}

/**
 * 从某条消息分叉：复制截至它的上下文到新会话。
 * - 单 Agent 会话 → 同 Agent 的专题（绝不设 isHome）
 * - 小组 / 无主会话 → 落到 `adoptTo` 指定的 Agent 专题（旧行为是不给就留空）
 */
export async function branchConversation(
  conversations: ConversationService,
  input: BranchConversationInput,
  options: { adoptTo?: string } = {}
): Promise<ServiceResult<Conversation>> {
  const source = await conversations.get(input.conversationId)
  if (!source) {
    return { ok: false, errors: ['E_NOT_FOUND'] }
  }
  const messages = await conversations.listMessages(input.conversationId)
  const index = messages.findIndex((message) => message.id === input.upToMessageId)
  if (index < 0) {
    return { ok: false, errors: ['E_NOT_FOUND'] }
  }

  const isGroup = source.groupId != null
  const inheritsOwner = !isGroup && source.assistantId != null && source.assistantId !== ''
  const created = await conversations.create({
    title: input.title?.trim() || branchTitle(source.title),
    assistantId: inheritsOwner ? source.assistantId : (options.adoptTo ?? null),
    workspaceId: source.workspaceId ?? null
  })
  if (!created.ok) {
    return { ok: false, errors: created.errors }
  }

  const model = source.model ?? null
  const providerId = source.providerId ?? null
  const params = source.params
  if (model !== null || providerId !== null || params !== undefined) {
    await conversations.setModel(created.value.id, {
      model,
      providerId,
      ...(params !== undefined ? { params } : {})
    })
  }

  for (const message of messages.slice(0, index + 1)) {
    await conversations.appendMessage(created.value.id, {
      role: message.role,
      content: message.content,
      status: message.status,
      ...(message.references ? { references: message.references } : {}),
      ...(message.reasoning ? { reasoning: message.reasoning } : {}),
      ...(typeof message.reasoningMs === 'number' ? { reasoningMs: message.reasoningMs } : {}),
      // 分叉要让历史附图跟着走，否则缩略图与胶囊全丢。
      ...(message.images && message.images.length > 0 ? { images: message.images } : {})
    })
  }

  const result = await conversations.get(created.value.id)
  return { ok: true, value: result ?? created.value }
}
