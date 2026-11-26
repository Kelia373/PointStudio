// lib/dispatchFilter —— 驻场工位的双轴过滤（Agent ⇄ Project）。
//
// 纯函数：不碰 React、不碰存储，方便单测，也方便将来搬 Rust。
import type { ConversationDto } from '../../../shared/types/ipc.ts'

export interface DispatchFilter {
  /** 选中某个 Agent：拿到它跨项目的执行记录。 */
  agentId?: string | null
  /** 选中某个项目；'unmounted' 表示「主聊天 / 未挂载项目的随手聊」。 */
  workspaceId?: string | null | 'unmounted'
  /** 标题关键词，忽略大小写与首尾空白。 */
  keyword?: string
}

export function filterSessionsByAxis(
  sessions: ConversationDto[],
  filter: DispatchFilter = {}
): ConversationDto[] {
  const keyword = (filter.keyword ?? '').trim().toLowerCase()

  return sessions.filter((session) => {
    if (filter.agentId !== undefined && filter.agentId !== null && session.assistantId !== filter.agentId) {
      return false
    }

    if (filter.workspaceId === 'unmounted') {
      if (session.workspaceId !== null && session.workspaceId !== undefined) {
        return false
      }
    } else if (
      filter.workspaceId !== undefined &&
      filter.workspaceId !== null &&
      session.workspaceId !== filter.workspaceId
    ) {
      return false
    }

    if (keyword !== '' && !session.title.toLowerCase().includes(keyword)) {
      return false
    }

    return true
  })
}

export interface AgentBenchStatus {
  state: 'idle' | 'working'
  /** 该 Agent 名下的会话数。 */
  activeCount: number
  /** 正在执行的那条标题；空闲时给最近一条。 */
  lastTitle: string | null
}

/** 侧栏 Agent 行的驻场状态：谁在干活，干的是哪条。 */
export function computeAgentBenchStatus(
  agentId: string,
  sessions: ConversationDto[],
  inflightSessionId: string | null
): AgentBenchStatus {
  const owned = sessions.filter((session) => session.assistantId === agentId)
  const running = inflightSessionId
    ? owned.find((session) => session.id === inflightSessionId) ?? null
    : null
  const sorted = [...owned].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const latest = running ?? sorted[0] ?? null

  return {
    state: running ? 'working' : 'idle',
    activeCount: owned.length,
    lastTitle: latest ? latest.title : null
  }
}
