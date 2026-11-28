// services/assistantCleanup —— 删除助手 / 启动收编时的连带处理。
//
// 为什么必须单独一层：AssistantService 不认识会话，ConversationService 也
// 不该反向依赖助手。删除动作横跨两者，只能由编排层负责——否则会留下
// 「会话仍绑定已删助手」的悬空引用：界面看着正常（下拉为空），数据里是脏的。
import { DEFAULT_ASSISTANT_ID } from '../ai/domain/assistant.ts'
import type { AssistantService } from './assistantService.ts'
import type { ConversationService } from './conversationService.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface CleanupCounts {
  removedAssistant: boolean
  unboundConversations: number
}

export interface RemoveAssistantOptions {
  /**
   * 会话的新家。给了就把非小组会话转绑过去（内置通用助手），
   * 不给则沿用旧行为「解绑成 null」——老测试与老调用方都不受影响。
   */
  adoptTo?: string
}

export async function removeAssistantAndUnbind(
  assistants: AssistantService,
  conversations: ConversationService,
  assistantId: string,
  options: RemoveAssistantOptions = {}
): Promise<ServiceResult<CleanupCounts>> {
  // 内置通用助手是收编落点，删掉它等于把所有历史会话变成孤儿。
  if (assistantId === DEFAULT_ASSISTANT_ID) {
    return { ok: false, errors: ['E_BUILTIN_PROTECTED'] }
  }

  // 先确认助手存在：不存在就什么都不做，避免"删失败但解绑成功"的半套状态。
  const target = await assistants.get(assistantId)
  if (!target) {
    return { ok: false, errors: ['E_NOT_FOUND'] }
  }

  const removed = await assistants.remove(assistantId)
  if (!removed.ok) {
    return { ok: false, errors: removed.errors }
  }

  const adoptTo = options.adoptTo ?? null
  let unbound = 0
  for (const conversation of await conversations.list()) {
    if (conversation.assistantId !== assistantId) {
      continue
    }
    // 小组会话的归属看小组本身，不收编到通用助手，否则群聊会冒充单聊。
    const result =
      adoptTo !== null && conversation.groupId == null
        ? await conversations.adopt(conversation.id, adoptTo)
        : await conversations.setAssistant(conversation.id, null)
    if (result.ok) {
      unbound += 1
    }
  }

  return { ok: true, value: { removedAssistant: true, unboundConversations: unbound } }
}

export interface AdoptCounts {
  /** 本次收编的会话条数；幂等跑第二遍时为 0。 */
  adopted: number
}

/**
 * 启动时的幂等收编：确保内置通用助手存在，再把所有「无主」单聊挂过去。
 *
 * 无主 = `assistantId` 为空，或指向一个已经不存在的 Agent（删号留下的孤儿）。
 * 小组会话一律不动：它们的归属是小组成员，不是通用助手。
 * 用 `adopt`（不是 `setAssistant`）是为了不刷新 `updatedAt`——
 * 迁移不该把用户的历史排序重排一遍。
 */
export async function adoptUnboundConversations(
  assistants: AssistantService,
  conversations: ConversationService
): Promise<AdoptCounts> {
  await assistants.ensureBuiltin()
  const known = new Set((await assistants.list()).map((item) => item.id))

  let adopted = 0
  for (const conversation of await conversations.list()) {
    if (conversation.groupId != null) {
      continue
    }
    const owner = conversation.assistantId
    if (typeof owner === 'string' && owner !== '' && known.has(owner)) {
      continue
    }
    const result = await conversations.adopt(conversation.id, DEFAULT_ASSISTANT_ID)
    if (result.ok) {
      adopted += 1
    }
  }

  return { adopted }
}
