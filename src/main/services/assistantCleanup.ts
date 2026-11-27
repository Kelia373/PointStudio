// services/assistantCleanup —— 删除助手时的连带处理。
//
// 为什么必须单独一层：AssistantService 不认识会话，ConversationService 也
// 不该反向依赖助手。删除动作横跨两者，只能由编排层负责——否则会留下
// 「会话仍绑定已删助手」的悬空引用：界面看着正常（下拉为空），数据里是脏的。
import type { AssistantService } from './assistantService.ts'
import type { ConversationService } from './conversationService.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface CleanupCounts {
  removedAssistant: boolean
  unboundConversations: number
}

export async function removeAssistantAndUnbind(
  assistants: AssistantService,
  conversations: ConversationService,
  assistantId: string
): Promise<ServiceResult<CleanupCounts>> {
  // 先确认助手存在：不存在就什么都不做，避免"删失败但解绑成功"的半套状态。
  const target = await assistants.get(assistantId)
  if (!target) {
    return { ok: false, errors: ['E_NOT_FOUND'] }
  }

  const removed = await assistants.remove(assistantId)
  if (!removed.ok) {
    return { ok: false, errors: removed.errors }
  }

  let unbound = 0
  for (const conversation of await conversations.list()) {
    if (conversation.assistantId !== assistantId) {
      continue
    }
    const result = await conversations.setAssistant(conversation.id, null)
    if (result.ok) {
      unbound += 1
    }
  }

  return { ok: true, value: { removedAssistant: true, unboundConversations: unbound } }
}
