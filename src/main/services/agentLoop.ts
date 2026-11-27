// services/agentLoop —— 一个目标的完整推进：生成 → 执行 → 失败 → 重规划 → 再执行。
//
// 这一层只做编排，把三块已有能力接起来：
//   planService.generatePlan / ai/agent.executor.executePlan / planService.replanAfterFailure
// 依赖以函数形式注入，测试里换成桩即可，不必真调模型。
//
// 三条边界：
// 1. 待确认（stopped）不是失败——重规划解决不了「人还没点头」，直接停下；
// 2. 重规划次数有上限，用完就停，不无限自愈；
// 3. 每次的计划与步骤变化都回调，界面据此显示过程（不猜进度）。
import type { ExecuteResult } from '../ai/agent/executor.ts'
import type { Plan } from '../ai/agent/plan.ts'
import type { GeneratePlanResult } from './planService.ts'

export type RunStatus = 'completed' | 'failed' | 'stopped'

export interface ReplanRequest {
  plan: Plan
  failedStepId: string
  errorCode: string
}

export interface RunGoalDeps {
  generate: (goal: string) => Promise<GeneratePlanResult>
  execute: (
    plan: Plan,
    options: { confirmedStepIds?: string[]; onStepChange?: (plan: Plan) => void }
  ) => Promise<ExecuteResult>
  replan: (request: ReplanRequest) => Promise<GeneratePlanResult>
  /** 失败后最多重规划几次，默认 1。 */
  maxReplans?: number
  confirmedStepIds?: string[]
  onPlan?: (plan: Plan) => void
  onStepChange?: (plan: Plan) => void
  onReplan?: (request: ReplanRequest) => void
}

export interface RunGoalResult {
  status: RunStatus
  /** 最终生效的计划（可能是修订版）。 */
  plan: Plan
  /** 每一轮的计划与执行结果，用于回放。 */
  history: Array<{ plan: Plan; result: ExecuteResult }>
  reason?: string
  errors?: string[]
}

export async function runGoal(goal: string, deps: RunGoalDeps): Promise<RunGoalResult> {
  const maxReplans = Math.max(0, deps.maxReplans ?? 1)

  const generated = await deps.generate(goal)
  if (!generated.ok) {
    // 计划都没拿到，就没有「最终计划」可言；用一个空历史 + 失败状态表达。
    return {
      status: 'failed',
      plan: emptyPlan(goal),
      history: [],
      reason: 'E_PLAN_GENERATION_FAILED',
      errors: generated.errors
    }
  }

  let plan = generated.value
  deps.onPlan?.(plan)

  const history: Array<{ plan: Plan; result: ExecuteResult }> = []
  let replansUsed = 0

  for (;;) {
    const result = await deps.execute(plan, {
      confirmedStepIds: deps.confirmedStepIds,
      onStepChange: deps.onStepChange
    })
    history.push({ plan, result })

    if (result.status === 'completed') {
      return { status: 'completed', plan: result.plan, history }
    }

    if (result.status === 'stopped') {
      return { status: 'stopped', plan: result.plan, history, reason: result.reason }
    }

    // 失败：能重规划就重规划，否则收摊。
    if (replansUsed >= maxReplans) {
      return { status: 'failed', plan: result.plan, history, reason: result.reason }
    }

    const failedStep =
      result.stepResults.find((step) => step.status === 'failed') ?? result.stepResults[0]
    const request: ReplanRequest = {
      plan: result.plan,
      failedStepId: failedStep?.id ?? '1',
      errorCode: result.reason ?? 'E_UNKNOWN'
    }
    deps.onReplan?.(request)

    const replanned = await deps.replan(request)
    replansUsed += 1
    if (!replanned.ok) {
      return {
        status: 'failed',
        plan: result.plan,
        history,
        reason: 'E_REPLAN_FAILED',
        errors: replanned.errors
      }
    }

    plan = replanned.value
    deps.onPlan?.(plan)
  }
}

/** 生成失败时的占位计划：不产出任何可执行步骤，避免调用方拿到 undefined。 */
function emptyPlan(goal: string): Plan {
  return {
    goal,
    assumptions: [],
    steps: [],
    stopConditions: [],
    rollback: '',
    costEstimate: { tokens: 0, wallClockSec: 0 },
    createdAt: new Date(0).toISOString()
  }
}
