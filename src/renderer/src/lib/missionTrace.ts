// lib/missionTrace —— 主群「一令一链」的聚合与过滤（纯函数）。
//
// 主人每安排一件事就有一条 missionId；架构派单、开发执行、测试验收都挂在同一条链上。
// 这里只做归拢，不猜数据：消息没有 missionId 就是普通对话，不硬塞进任何链。
import type { AgentWorkerRunDto } from '../../../shared/types/ipc.ts'
import type { UiMessage } from './chatState.ts'

export type MissionStatus = 'queued' | 'working' | 'waiting' | 'error' | 'completed'

export interface MissionProgress {
  current: number
  total: number
  stepLabel: string
}

export interface MissionChainSummary {
  missionId: string
  title: string
  /** 参与接力的 agentId，按首次出现顺序；'owner' 表示主人。 */
  participants: string[]
  status: MissionStatus
  progress?: MissionProgress
  /** 未完成的 Run 数（含 Subagent）。 */
  activeRunCount: number
  messageCount: number
  /** 最早一条 Run 的开始时间；没有 Run 时为空串。 */
  startedAt: string
}

const STATUS_PRIORITY: Record<MissionStatus, number> = {
  error: 0,
  waiting: 1,
  working: 2,
  queued: 3,
  completed: 4
}

function statusOfRuns(runs: AgentWorkerRunDto[]): MissionStatus {
  if (runs.length === 0) {
    return 'completed'
  }
  let status: MissionStatus = 'completed'
  for (const run of runs) {
    if (STATUS_PRIORITY[run.status] < STATUS_PRIORITY[status]) {
      status = run.status
    }
  }
  return status
}

function missionOf(message: UiMessage): string | null {
  return message.missionId ?? message.handoff?.missionId ?? null
}

/** 按 missionId 归拢消息与 Run，输出一条链的摘要；顺序按首次出现。 */
export function buildMissionChains(
  messages: UiMessage[],
  runs: AgentWorkerRunDto[]
): MissionChainSummary[] {
  const order: string[] = []
  const buckets = new Map<
    string,
    { messages: UiMessage[]; runs: AgentWorkerRunDto[]; participants: string[] }
  >()

  const bucketOf = (missionId: string) => {
    let bucket = buckets.get(missionId)
    if (!bucket) {
      bucket = { messages: [], runs: [], participants: [] }
      buckets.set(missionId, bucket)
      order.push(missionId)
    }
    return bucket
  }

  for (const message of messages) {
    const missionId = missionOf(message)
    if (!missionId) {
      continue
    }
    const bucket = bucketOf(missionId)
    bucket.messages.push(message)
    if (message.handoff) {
      for (const agentId of [message.handoff.fromAgentId, message.handoff.toAgentId]) {
        if (!bucket.participants.includes(agentId)) {
          bucket.participants.push(agentId)
        }
      }
    }
  }

  for (const run of runs) {
    const bucket = bucketOf(run.missionId)
    bucket.runs.push(run)
    if (!bucket.participants.includes(run.agentId)) {
      bucket.participants.push(run.agentId)
    }
  }

  return order.map((missionId) => {
    const bucket = buckets.get(missionId)!
    const activeRuns = bucket.runs.filter((run) => run.status !== 'completed')
    const firstRun = activeRuns[0] ?? bucket.runs[0] ?? null
    const firstMessage = bucket.messages[0] ?? null

    return {
      missionId,
      title:
        firstMessage?.handoff?.summary ??
        firstRun?.taskTitle ??
        (firstMessage ? firstMessage.content.slice(0, 40) : missionId),
      participants: bucket.participants,
      status: statusOfRuns(bucket.runs),
      ...(firstRun?.progress ? { progress: firstRun.progress } : {}),
      activeRunCount: activeRuns.length,
      messageCount: bucket.messages.length,
      startedAt: firstRun?.startedAt ?? ''
    }
  })
}

/** 只看一条任务链；missionId 为 null 表示不过滤（原样返回）。 */
export function filterMessagesByMission(
  messages: UiMessage[],
  missionId: string | null
): UiMessage[] {
  if (missionId === null) {
    return messages
  }
  return messages.filter((message) => missionOf(message) === missionId)
}
