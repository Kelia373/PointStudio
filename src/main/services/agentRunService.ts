// services/agentRunService —— 把一次「目标推进」变成界面能显示的视图 + 事件。
//
// 真正的编排在 ai/agent/executor 与 services/agentLoop，这里只做两件事：
// 1. 把 Plan 映射成界面视图（不含 input 等内部数据）；
// 2. 明确「哪些事件值得推给界面」。界面据此显示过程，而不是猜。
import { summarizeProgress, type Plan, type PlanStep } from '../ai/agent/plan.ts'

export type PlanStepStatusView = PlanStep['status']

export interface PlanStepView {
  id: string
  action: string
  tool: string | null
  expect: string
  risk: PlanStep['risk']
  status: PlanStepStatusView
  /** 高风险步骤：界面应提示「执行前需要你确认」。 */
  requiresConfirmation: boolean
}

export interface PlanView {
  goal: string
  assumptions: string[]
  stopConditions: string[]
  steps: PlanStepView[]
  progress: ReturnType<typeof summarizeProgress>
}

export function toPlanView(plan: Plan): PlanView {
  return {
    goal: plan.goal,
    assumptions: [...plan.assumptions],
    stopConditions: [...plan.stopConditions],
    steps: plan.steps.map((step) => ({
      id: step.id,
      action: step.action,
      tool: step.tool,
      expect: step.expect,
      risk: step.risk,
      status: step.status,
      requiresConfirmation: step.risk === 'high'
    })),
    progress: summarizeProgress(plan)
  }
}

export type AgentEvent =
  | { type: 'plan'; plan: PlanView }
  | { type: 'step'; plan: PlanView }
  | { type: 'replan'; failedStepId: string; errorCode: string }
  | { type: 'done'; status: 'completed' | 'failed' | 'stopped'; plan: PlanView; reason?: string }
  | { type: 'error'; code: string }

/** 状态文案留给界面，这里只给码与结构化数据。 */
export const AGENT_EVENT_TYPES = ['plan', 'step', 'replan', 'done', 'error'] as const
