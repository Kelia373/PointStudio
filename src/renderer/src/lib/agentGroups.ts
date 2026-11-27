// lib/agentGroups —— Agent 小组的纯函数层（CRUD、成员归属、排序筛选、组状态聚合）。
//
// 小组数据只存在渲染层 localStorage（key: pointstudio.agentGroups），
// 不塞进 AssistantDto：一个 Agent 将来可能跨组兼职，单值 groupId 会作废。
// 这里所有函数都不碰 React / DOM，方便单测，也方便决定「多归属 / 单归属」后直接复用。
import type {
  AgentGroupDto,
  AgentWorkerRunDto,
  AssistantDto,
  ConversationDto
} from '../../../shared/types/ipc.ts'
import { computeAgentBenchStatus, type AgentLightState } from './dispatchFilter.ts'
import type { PlanRunStatus } from './planRunState.ts'

export const AGENT_GROUPS_KEY = 'pointstudio.agentGroups'

/** 一个 Agent 可以同时属于多个组（multi），或入新组时自动从旧组移出（single）。 */
export type GroupMembershipMode = 'multi' | 'single'
export type AgentSortMode = 'manual' | 'recent'

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    if (typeof value === 'string' && value !== '' && !seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
  }
  return out
}

/** 坏数据一律丢弃或修正：宁可少一个组，也不要让侧栏渲染出空洞。 */
function sanitizeGroup(value: unknown): AgentGroupDto | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }
  const record = value as Record<string, unknown>
  if (typeof record['id'] !== 'string' || record['id'] === '') {
    return null
  }
  const memberIds = uniqueStrings(record['memberIds'])
  const lead =
    typeof record['leadAgentId'] === 'string' && memberIds.includes(record['leadAgentId'])
      ? record['leadAgentId']
      : memberIds[0] ?? null
  return {
    id: record['id'],
    name: typeof record['name'] === 'string' && record['name'] !== '' ? record['name'] : '未命名小组',
    memberIds,
    leadAgentId: lead,
    collapsed: record['collapsed'] === true,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : ''
  }
}

export function parseAgentGroups(raw: string | null): AgentGroupDto[] {
  if (!raw) {
    return []
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) {
    return []
  }
  const seen = new Set<string>()
  const out: AgentGroupDto[] = []
  for (const item of parsed) {
    const group = sanitizeGroup(item)
    if (group && !seen.has(group.id)) {
      seen.add(group.id)
      out.push(group)
    }
  }
  return out
}

/** 删掉已被删除的 Agent、修正组长；小组本身不会因为成员清空而消失。 */
export function normalizeGroups(
  groups: AgentGroupDto[],
  assistants: AssistantDto[]
): AgentGroupDto[] {
  const known = new Set(assistants.map((agent) => agent.id))
  let changed = false
  const next = groups.map((group) => {
    const memberIds = group.memberIds.filter((id) => known.has(id))
    const leadAgentId =
      group.leadAgentId !== null && memberIds.includes(group.leadAgentId)
        ? group.leadAgentId
        : memberIds[0] ?? null
    if (
      memberIds.length === group.memberIds.length &&
      leadAgentId === group.leadAgentId
    ) {
      return group
    }
    changed = true
    return { ...group, memberIds, leadAgentId }
  })
  return changed ? next : groups
}

export function createGroup(
  groups: AgentGroupDto[],
  input: { id: string; name: string; now: string; memberIds?: string[]; leadAgentId?: string | null }
): AgentGroupDto[] {
  if (groups.some((group) => group.id === input.id)) {
    return groups
  }
  const memberIds = uniqueStrings(input.memberIds ?? [])
  const leadAgentId =
    input.leadAgentId !== undefined && input.leadAgentId !== null && memberIds.includes(input.leadAgentId)
      ? input.leadAgentId
      : memberIds[0] ?? null
  return [
    ...groups,
    {
      id: input.id,
      name: input.name.trim() === '' ? '未命名小组' : input.name.trim(),
      memberIds,
      leadAgentId,
      collapsed: false,
      updatedAt: input.now
    }
  ]
}

export function renameGroup(
  groups: AgentGroupDto[],
  groupId: string,
  name: string,
  now: string
): AgentGroupDto[] {
  const trimmed = name.trim()
  if (trimmed === '') {
    return groups
  }
  return groups.map((group) =>
    group.id === groupId ? { ...group, name: trimmed, updatedAt: now } : group
  )
}

export function removeGroup(groups: AgentGroupDto[], groupId: string): AgentGroupDto[] {
  const next = groups.filter((group) => group.id !== groupId)
  return next.length === groups.length ? groups : next
}

/**
 * 把一个 Agent 放进小组。
 * single 模式：先从其它组移出（单选归属）；multi 模式：保留其它组的席位。
 */
export function addAgentToGroup(
  groups: AgentGroupDto[],
  agentId: string,
  groupId: string,
  mode: GroupMembershipMode,
  now: string
): AgentGroupDto[] {
  if (!groups.some((group) => group.id === groupId)) {
    return groups
  }
  return groups.map((group) => {
    if (group.id !== groupId) {
      if (mode !== 'single' || !group.memberIds.includes(agentId)) {
        return group
      }
      const remaining = group.memberIds.filter((id) => id !== agentId)
      return {
        ...group,
        memberIds: remaining,
        leadAgentId: group.leadAgentId === agentId ? remaining[0] ?? null : group.leadAgentId,
        updatedAt: now
      }
    }
    if (group.memberIds.includes(agentId)) {
      return group
    }
    return {
      ...group,
      memberIds: [...group.memberIds, agentId],
      leadAgentId: group.leadAgentId ?? agentId,
      updatedAt: now
    }
  })
}

export function removeAgentFromGroup(
  groups: AgentGroupDto[],
  agentId: string,
  groupId: string,
  now: string
): AgentGroupDto[] {
  return groups.map((group) => {
    if (group.id !== groupId || !group.memberIds.includes(agentId)) {
      return group
    }
    const memberIds = group.memberIds.filter((id) => id !== agentId)
    return {
      ...group,
      memberIds,
      leadAgentId: group.leadAgentId === agentId ? memberIds[0] ?? null : group.leadAgentId,
      updatedAt: now
    }
  })
}

export function setGroupLead(
  groups: AgentGroupDto[],
  groupId: string,
  agentId: string,
  now: string
): AgentGroupDto[] {
  return groups.map((group) => {
    if (group.id !== groupId || !group.memberIds.includes(agentId)) {
      return group
    }
    return { ...group, leadAgentId: agentId, updatedAt: now }
  })
}

export function toggleGroupCollapsed(
  groups: AgentGroupDto[],
  groupId: string,
  collapsed?: boolean
): AgentGroupDto[] {
  return groups.map((group) => {
    if (group.id !== groupId) {
      return group
    }
    const next = collapsed ?? !group.collapsed
    return next === group.collapsed ? group : { ...group, collapsed: next }
  })
}

/** 某个 Agent 所在的所有组（多归属时可能不止一个）。 */
export function agentGroupIds(groups: AgentGroupDto[], agentId: string): string[] {
  return groups.filter((group) => group.memberIds.includes(agentId)).map((group) => group.id)
}

/** 不属于任何组、也不在某个组里的 Agent。 */
export function ungroupedAgents(
  groups: AgentGroupDto[],
  assistants: AssistantDto[]
): AssistantDto[] {
  const grouped = new Set<string>()
  for (const group of groups) {
    for (const id of group.memberIds) {
      grouped.add(id)
    }
  }
  return assistants.filter((agent) => !grouped.has(agent.id))
}

export function filterAgents(
  assistants: AssistantDto[],
  options: { keyword?: string; hideDisabled?: boolean } = {}
): AssistantDto[] {
  const keyword = (options.keyword ?? '').trim().toLowerCase()
  return assistants.filter((agent) => {
    if (options.hideDisabled === true && agent.enabled === false) {
      return false
    }
    return keyword === '' || agent.name.toLowerCase().includes(keyword)
  })
}

/** 手动排序 = 保持后端顺序（本期不做拖拽重排）；最近更新 = updatedAt 降序。 */
export function sortAgents(assistants: AssistantDto[], mode: AgentSortMode): AssistantDto[] {
  if (mode === 'manual') {
    return assistants
  }
  return [...assistants].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export interface AgentGroupBench {
  state: AgentLightState
  /** 组内仍存在的 Agent 数。 */
  memberCount: number
  workingCount: number
  disabledCount: number
}

/**
 * 小组的状态灯：任何一个成员在跑就是 working，其次 waiting / error；
 * 全员停用才是 disabled，避免「组里只要有一个停用就整组变灰」。
 */
export function computeGroupBenchStatus(
  group: AgentGroupDto,
  assistants: AssistantDto[],
  conversations: ConversationDto[],
  inflightConversationId: string | null,
  options: {
    planStatus?: PlanRunStatus | null
    planSessionId?: string | null
    workerRuns?: AgentWorkerRunDto[]
  } = {}
): AgentGroupBench {
  const members = group.memberIds
    .map((id) => assistants.find((agent) => agent.id === id) ?? null)
    .filter((agent): agent is AssistantDto => agent !== null)

  const states = members.map(
    (agent) =>
      computeAgentBenchStatus(agent.id, conversations, inflightConversationId, {
        enabled: agent.enabled !== false,
        planStatus: options.planStatus ?? null,
        activeSessionId: options.planSessionId ?? null,
        ...(options.workerRuns ? { workerRuns: options.workerRuns } : {})
      }).state
  )

  const workingCount = states.filter((state) => state === 'working').length
  const disabledCount = states.filter((state) => state === 'disabled').length

  let state: AgentLightState = 'idle'
  if (members.length > 0 && disabledCount === members.length) {
    state = 'disabled'
  } else if (workingCount > 0) {
    state = 'working'
  } else if (states.includes('waiting')) {
    state = 'waiting'
  } else if (states.includes('error')) {
    state = 'error'
  }

  return { state, memberCount: members.length, workingCount, disabledCount }
}
