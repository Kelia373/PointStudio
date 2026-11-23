// renderer/lib/planConfirm —— 从计划视图里找出「需要用户确认」的步骤。
//
// 背景：执行器遇到未确认的高风险步骤会整份计划停下（fail-closed），
// 但此前界面没有任何入口能把这些 id 交回去——计划就此死住。
// 这里的两条规则供「确认并继续」使用。
import type { PlanViewDto } from '../../../shared/types/ipc.ts'

/** 所有高风险步骤（含已完成的）。 */
export function highRiskStepIds(plan: PlanViewDto): string[] {
  return plan.steps.filter((step) => step.requiresConfirmation).map((step) => step.id)
}

/** 仅「还没执行」的高风险步骤：已完成/已跳过的不该再拦住计划。 */
export function pendingHighRiskStepIds(plan: PlanViewDto): string[] {
  return plan.steps
    .filter(
      (step) =>
        step.requiresConfirmation && step.status !== 'success' && step.status !== 'skipped'
    )
    .map((step) => step.id)
}
