// ai/agent/executor —— 计划的执行循环。
//
// 只做编排，不实现具体能力：每一步要么委托给工具注册表，要么标记为
// 「这步得人或模型自己来」（无 tool 的步骤 → skipped）。
//
// 两道闸门写在这里，因为它们比"跑得快"更重要：
// 1. **确认门**：含高风险步骤且未被确认时，整份计划一步都不执行——
//    检查必须在任何副作用发生之前，不能边跑边问。
// 2. **失败即停**（默认）：一步失败就停下来，后续步骤保持 pending。
//    让用户看到"卡在哪，而不是继续制造半成品"。
import type { ToolRegistry } from '../tools/registry.ts'
import { markStep, needsConfirmation, type Plan, type PlanStep } from './plan.ts'

export type ExecuteStatus = 'completed' | 'failed' | 'stopped'

export interface StepOutcome {
  id: string
  status: PlanStep['status']
  /** 失败时的错误码。 */
  code?: string
  /** 这一步实际调用的工具（无工具步骤不填）。 */
  tool?: string
  /** 这一步花了多久（无工具步骤不填）。 */
  durationMs?: number
}

export interface ExecuteResult {
  /** 执行后的计划（原计划不被修改）。 */
  plan: Plan
  status: ExecuteStatus
  /** 非 completed 时的原因码。 */
  reason?: string
  stepResults: StepOutcome[]
}

export interface ExecuteOptions {
  tools: ToolRegistry
  /** 已被用户确认的高风险步骤 id。 */
  confirmedStepIds?: string[]
  /** 失败后是否继续，默认 stop。 */
  onFailure?: 'stop' | 'continue'
  /** 每次状态推进后回调，供界面显示「走到哪一步」。 */
  onStepChange?: (plan: Plan) => void
}

export async function executePlan(plan: Plan, options: ExecuteOptions): Promise<ExecuteResult> {
  const confirmed = new Set(options.confirmedStepIds ?? [])
  const unconfirmed = needsConfirmation(plan).filter((step) => !confirmed.has(step.id))
  if (unconfirmed.length > 0) {
    return {
      plan,
      status: 'stopped',
      reason: 'E_STEP_NEEDS_CONFIRMATION',
      stepResults: plan.steps.map((step) => ({ id: step.id, status: step.status }))
    }
  }

  let current = plan
  const stepResults: StepOutcome[] = []
  const failureMode = options.onFailure ?? 'stop'

  for (const planned of plan.steps) {
    if (planned.tool === null) {
      current = markStep(current, planned.id, 'skipped')
      options.onStepChange?.(current)
      stepResults.push({ id: planned.id, status: 'skipped' })
      continue
    }

    current = markStep(current, planned.id, 'running')
    options.onStepChange?.(current)

    const startedAt = Date.now()
    const result = await options.tools.run(planned.tool, planned.input)
    const durationMs = Date.now() - startedAt

    if (result.ok) {
      current = markStep(current, planned.id, 'success')
      options.onStepChange?.(current)
      stepResults.push({
        id: planned.id,
        status: 'success',
        tool: planned.tool,
        durationMs
      })
      continue
    }

    current = markStep(current, planned.id, 'failed')
    options.onStepChange?.(current)
    stepResults.push({
      id: planned.id,
      status: 'failed',
      code: result.code,
      tool: planned.tool,
      durationMs
    })

    if (failureMode === 'stop') {
      return { plan: current, status: 'failed', reason: result.code, stepResults }
    }
  }

  const anyFailed = stepResults.some((outcome) => outcome.status === 'failed')
  return {
    plan: current,
    status: anyFailed ? 'failed' : 'completed',
    reason: anyFailed ? stepResults.find((o) => o.code)?.code : undefined,
    stepResults
  }
}
