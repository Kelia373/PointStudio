// lib/workerRuns —— 从渲染层真实运行态派生并发泳道。
//
// 这里不造假数据：只有「确实在流式」或「计划确实在跑/停/失败」的会话才会产出一条 Run。
// 同一会话同时命中两者时合并成一条，进度取计划里的真实步骤数。
import type { AgentWorkerRunDto, ConversationDto } from '../../../shared/types/ipc.ts'
import type { PlanRunState } from './planRunState.ts'

export interface DeriveWorkerRunsInput {
  conversations: ConversationDto[]
  /** 正在流式输出的会话 id（不是 requestId）。 */
  inflightConversationId: string | null
  planRun: PlanRunState | null
}

const PLAN_STATUS: Record<string, AgentWorkerRunDto['status'] | null> = {
  running: 'working',
  stopped: 'waiting',
  failed: 'error',
  completed: null,
  idle: null
}

function progressOf(planRun: PlanRunState): AgentWorkerRunDto['progress'] {
  const plan = planRun.plan
  if (!plan) {
    return undefined
  }
  const { progress, steps } = plan
  const runningStep = steps.find((step) => step.status === 'running')
  return {
    current: progress.success + progress.failed + progress.skipped,
    total: progress.total,
    stepLabel: runningStep?.action ?? plan.goal
  }
}

/** 只产出「真实在跑」的 Run；没有活跃会话时返回空数组，绝不画空壳。 */
export function deriveActiveWorkerRuns(input: DeriveWorkerRunsInput): AgentWorkerRunDto[] {
  const bySession = new Map<string, AgentWorkerRunDto>()
  const sessionOf = (id: string) => input.conversations.find((item) => item.id === id) ?? null

  const planSessionId = input.planRun?.sessionId ?? null
  const planStatus = input.planRun ? (PLAN_STATUS[input.planRun.status] ?? null) : null
  const planProgress = input.planRun ? progressOf(input.planRun) : undefined
  if (planSessionId && planStatus) {
    const conversation = sessionOf(planSessionId)
    if (conversation?.assistantId) {
      bySession.set(conversation.id, {
        runId: `run-${conversation.id}`,
        agentId: conversation.assistantId,
        subagentRole: null,
        missionId: conversation.id,
        dispatchedBy: 'owner',
        taskTitle: conversation.title,
        sessionId: conversation.id,
        status: planStatus,
        ...(planProgress ? { progress: planProgress } : {}),
        startedAt: conversation.updatedAt
      })
    }
  }

  if (input.inflightConversationId) {
    const conversation = sessionOf(input.inflightConversationId)
    if (conversation?.assistantId) {
      const existing = bySession.get(conversation.id)
      bySession.set(conversation.id, {
        runId: `run-${conversation.id}`,
        agentId: conversation.assistantId,
        subagentRole: null,
        missionId: conversation.id,
        dispatchedBy: 'owner',
        taskTitle: conversation.title,
        sessionId: conversation.id,
        // 流式输出优先：它比计划状态更新
        status: 'working',
        ...(existing?.progress ? { progress: existing.progress } : {}),
        startedAt: existing?.startedAt ?? conversation.updatedAt
      })
    }
  }

  return [...bySession.values()]
}
