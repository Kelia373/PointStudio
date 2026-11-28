// lib/conversationBuckets —— 会话按「自由对话 / Agent 主聊天 / Agent 专题 / 小组」分桶。
//
// 纯函数，不碰 React / DOM / 存储：侧栏只负责渲染，分桶规则由测试钉死。
// 兜底原则：assistantId 指向不存在 Agent 的孤儿会话归入自由对话，绝不丢。
import type { AssistantDto, ConversationDto } from '../../../shared/types/ipc.ts'

export interface ConversationBuckets {
  /** 未绑定 Agent 且非小组的自由对话（含孤儿兜底），updatedAt 倒序。 */
  freeChats: ConversationDto[]
  /** 每个 Agent 当前唯一的主聊天（isHome === true && 非小组）。 */
  agentHomeById: Record<string, ConversationDto | null>
  /** 每个 Agent 下的专题 / 归档子会话（!isHome && 非小组），updatedAt 倒序。 */
  agentTopicsById: Record<string, ConversationDto[]>
  /** 小组会话，按 groupId 分桶，updatedAt 倒序。 */
  groupChatsById: Record<string, ConversationDto[]>
}

function byUpdatedDesc(a: ConversationDto, b: ConversationDto): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
}

export function partitionConversations(
  conversations: readonly ConversationDto[],
  assistants: readonly Pick<AssistantDto, 'id'>[]
): ConversationBuckets {
  const knownAgents = new Set(assistants.map((assistant) => assistant.id))
  const freeChats: ConversationDto[] = []
  const agentHomeById: Record<string, ConversationDto | null> = {}
  const agentTopicsById: Record<string, ConversationDto[]> = {}
  const groupChatsById: Record<string, ConversationDto[]> = {}

  for (const conversation of conversations) {
    if (conversation.groupId != null) {
      const list = groupChatsById[conversation.groupId] ?? []
      list.push(conversation)
      groupChatsById[conversation.groupId] = list
      continue
    }
    if (conversation.assistantId === null || conversation.assistantId === undefined) {
      freeChats.push(conversation)
      continue
    }
    if (!knownAgents.has(conversation.assistantId)) {
      // Agent 已被删除：会话按自由对话兜底，不悬挂。
      freeChats.push(conversation)
      continue
    }
    if (conversation.isHome === true) {
      const existing = agentHomeById[conversation.assistantId] ?? null
      if (existing === null || conversation.updatedAt > existing.updatedAt) {
        if (existing !== null) {
          const topics = agentTopicsById[conversation.assistantId] ?? []
          topics.push(existing)
          agentTopicsById[conversation.assistantId] = topics
        }
        agentHomeById[conversation.assistantId] = conversation
      } else {
        const topics = agentTopicsById[conversation.assistantId] ?? []
        topics.push(conversation)
        agentTopicsById[conversation.assistantId] = topics
      }
      continue
    }
    const topics = agentTopicsById[conversation.assistantId] ?? []
    topics.push(conversation)
    agentTopicsById[conversation.assistantId] = topics
  }

  for (const list of Object.values(agentTopicsById)) {
    list.sort(byUpdatedDesc)
  }
  for (const list of Object.values(groupChatsById)) {
    list.sort(byUpdatedDesc)
  }
  freeChats.sort(byUpdatedDesc)

  return { freeChats, agentHomeById, agentTopicsById, groupChatsById }
}

/** 找某个 Agent 的主聊天；忽略小组会话，多条时取最新。 */
export function findAgentHomeConversation(
  agentId: string,
  conversations: readonly ConversationDto[]
): ConversationDto | null {
  let found: ConversationDto | null = null
  for (const conversation of conversations) {
    if (
      conversation.isHome !== true ||
      conversation.assistantId !== agentId ||
      conversation.groupId != null
    ) {
      continue
    }
    if (found === null || conversation.updatedAt > found.updatedAt) {
      found = conversation
    }
  }
  return found
}
