// services/turnService —— 消息级的「整轮」操作。
//
// 为什么单独一层：删除一条用户消息却不删它的回答，会留下一段没有问题的
// 孤零零的答复；这种数据在导出、备份、回放时都很难解释。
//
// 规则：
// - 删用户消息 → 连带它之后、下一条用户消息之前的助手回复（即「这一轮」）；
// - 删助手消息 → 只删这一条（提问保留，用户可以重发）；
// - 找不到 → E_NOT_FOUND，一条都不动。
import type { Message } from '../ai/domain/conversation.ts'
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
