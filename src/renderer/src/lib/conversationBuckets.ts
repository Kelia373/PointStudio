// lib/conversationBuckets —— 会话按「自由对话 / Agent 主聊天 / Agent 专题 / 小组」分桶。
//
// 纯函数，不碰 React / DOM / 存储：侧栏只负责渲染，分桶规则由测试钉死。
// 兜底原则：assistantId 指向不存在 Agent 的孤儿会话归入自由对话，绝不丢。
import type { AssistantDto, ConversationDto } from '../../../shared/types/ipc.ts'

export interface ConversationBuckets {
  /** 旧自由对话桶：仅在未传 `defaultAssistantId` 时使用（兼容老调用方与老测试）。 */
  freeChats: ConversationDto[]
  /** 每个 Agent 当前唯一的主聊天（isHome === true && 非小组）。 */
  agentHomeById: Record<string, ConversationDto | null>
  /** 每个 Agent 下的专题 / 归档子会话（!isHome && 非小组），updatedAt 倒序。 */
  agentTopicsById: Record<string, ConversationDto[]>
  /** 小组会话，按 groupId 分桶，updatedAt 倒序。 */
  groupChatsById: Record<string, ConversationDto[]>
}

export interface BucketOptions {
  /**
   * 「全员归属 Agent」模式：无主 / 孤儿单聊兜底进这个 Agent 的专题桶，
   * `freeChats` 恒为空。不传则保持旧的自由对话分桶。
   */
  defaultAssistantId?: string
}

function byUpdatedDesc(a: ConversationDto, b: ConversationDto): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id)
}

export function partitionConversations(
  conversations: readonly ConversationDto[],
  assistants: readonly Pick<AssistantDto, 'id'>[],
  options: BucketOptions = {}
): ConversationBuckets {
  const knownAgents = new Set(assistants.map((assistant) => assistant.id))
  const fallback = options.defaultAssistantId
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
    const owner = conversation.assistantId
    const ownerId =
      typeof owner === 'string' && owner !== '' && knownAgents.has(owner) ? owner : null
    if (ownerId === null) {
      if (fallback === undefined) {
        // 旧行为：孤儿 / 无主会话归入自由对话，绝不丢。
        freeChats.push(conversation)
        continue
      }
      // 收编模式：没有归属就落到兜底 Agent 的专题，不再制造无主会话。
      const orphanTopics = agentTopicsById[fallback] ?? []
      orphanTopics.push(conversation)
      agentTopicsById[fallback] = orphanTopics
      continue
    }
    if (conversation.isHome === true) {
      const existing = agentHomeById[ownerId] ?? null
      if (existing === null || conversation.updatedAt > existing.updatedAt) {
        if (existing !== null) {
          const topics = agentTopicsById[ownerId] ?? []
          topics.push(existing)
          agentTopicsById[ownerId] = topics
        }
        agentHomeById[ownerId] = conversation
      } else {
        const topics = agentTopicsById[ownerId] ?? []
        topics.push(conversation)
        agentTopicsById[ownerId] = topics
      }
      continue
    }
    const topics = agentTopicsById[ownerId] ?? []
    topics.push(conversation)
    agentTopicsById[ownerId] = topics
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
