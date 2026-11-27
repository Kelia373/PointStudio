// lib/dispatchFilter —— 驻场工位的双轴过滤（Agent ⇄ Project）。
//
// 纯函数：不碰 React、不碰存储，方便单测，也方便将来搬 Rust。
import type { AgentWorkerRunDto, ConversationDto } from '../../../shared/types/ipc.ts'

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

/** 五态灯的人读文案；侧栏与顶栏共用一份，避免两处各写一遍。 */
export const LIGHT_LABEL: Record<AgentLightState, string> = {
  working: '工作中',
  waiting: '等待人工确认',
  error: '执行异常',
  idle: '空闲待命',
  disabled: '已停用'
}

/** 一个 Agent 的指示灯形态；五态互相排斥，界面只按 state 取一个类名。 */
export type AgentLightState = 'working' | 'waiting' | 'error' | 'idle' | 'disabled'

export interface AgentBenchStatus {
  state: AgentLightState
  /** 该 Agent 名下的会话数（永远按会话算，不含并发）。 */
  sessionCount: number
  /** 未完成 Run 数：没有 Run 台账时按「是否在流式」给 0/1。 */
  activeRunCount: number
  /**
   * @deprecated 等同 sessionCount，仅为旧调用方保留。
   * 新代码请用 sessionCount / activeRunCount，别让一个数字承担两种含义。
   */
  activeCount: number
  /** 正在执行的那条标题；空闲时给最近一条。 */
  lastTitle: string | null
}

export interface AgentBenchOptions {
  /** 老数据没有 enabled 字段，缺省视为启用。 */
  enabled?: boolean
  /** 只有当前绑定在这个 Agent 上的会话，计划状态才算数。 */
  planStatus?: 'idle' | 'running' | 'stopped' | 'completed' | 'failed' | null
  activeSessionId?: string | null
  /** 该 Agent 的多并发 Run 台账；传入后按真实并发数点亮与计数。 */
  workerRuns?: AgentWorkerRunDto[]
}

export interface AgentWorkerLanes {
  /** 未完成的 Run（含排队），working 在前。 */
  activeRuns: AgentWorkerRunDto[]
  workingCount: number
  subagentCount: number
}

const RUN_ORDER: Record<AgentWorkerRunDto['status'], number> = {
  working: 0,
  waiting: 1,
  error: 2,
  queued: 3,
  completed: 4
}

/** 一个 Agent 名下的并发泳道：主身与 Subagent 都算同一条工位。 */
export function computeAgentWorkerLanes(
  agentId: string,
  runs: AgentWorkerRunDto[]
): AgentWorkerLanes {
  const mine = runs.filter((run) => run.agentId === agentId)
  const activeRuns = mine
    .filter((run) => run.status !== 'completed')
    .sort(
      (a, b) =>
        RUN_ORDER[a.status] - RUN_ORDER[b.status] || a.startedAt.localeCompare(b.startedAt)
    )
  return {
    activeRuns,
    workingCount: activeRuns.filter((run) => run.status === 'working').length,
    subagentCount: activeRuns.filter((run) => run.subagentRole !== null).length
  }
}

/**
 * 侧栏 Agent 行的驻场状态：谁在干活，干的是哪条。
 *
 * 判定优先级固定为：停用 → 工作中（流式或计划在跑）→ 待人工确认 → 异常 → 空闲。
 * 停用排最前，是因为它表达的是「这个 Agent 不应该接活」，比瞬时执行态更根本。
 */
export function computeAgentBenchStatus(
  agentId: string,
  sessions: ConversationDto[],
  inflightSessionId: string | null,
  options: AgentBenchOptions = {}
): AgentBenchStatus {
  const owned = sessions.filter((session) => session.assistantId === agentId)
  const running = inflightSessionId
    ? owned.find((session) => session.id === inflightSessionId) ?? null
    : null
  // 计划是全局唯一的一条：只有它的会话确实挂在这个 Agent 上时才计入
  const active = options.activeSessionId
    ? owned.find((session) => session.id === options.activeSessionId) ?? null
    : null
  const planStatus = active ? (options.planStatus ?? null) : null
  const sorted = [...owned].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const latest = running ?? active ?? sorted[0] ?? null
  const lanes = options.workerRuns
    ? computeAgentWorkerLanes(agentId, options.workerRuns)
    : null
  const lanesWaiting = lanes?.activeRuns.some((run) => run.status === 'waiting') ?? false
  const lanesError = lanes?.activeRuns.some((run) => run.status === 'error') ?? false

  let state: AgentLightState = 'idle'
  if (options.enabled === false) {
    state = 'disabled'
  } else if (running !== null || planStatus === 'running' || (lanes?.workingCount ?? 0) > 0) {
    state = 'working'
  } else if (planStatus === 'stopped' || lanesWaiting) {
    state = 'waiting'
  } else if (planStatus === 'failed' || lanesError) {
    state = 'error'
  }

  return {
    state,
    sessionCount: owned.length,
    activeRunCount: lanes ? lanes.activeRuns.length : running !== null ? 1 : 0,
    activeCount: owned.length,
    lastTitle: lanes?.activeRuns[0]?.taskTitle ?? (latest ? latest.title : null)
  }
}
