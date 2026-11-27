// renderer/lib/planConfirm —— 从计划视图里找出「需要用户确认」的步骤。
//
// 背景：执行器遇到未确认的高风险步骤会整份计划停下（fail-closed），
// 但此前界面没有任何入口能把这些 id 交回去——计划就此死住。
// 这里的两条规则供「确认并继续」使用。
import type { AgentPermissionMode, PlanViewDto } from '../../../shared/types/ipc.ts'

/** 还没执行、也没被跳过的步骤。 */
function pendingSteps(plan: PlanViewDto | null | undefined): PlanViewDto['steps'] {
  if (!plan) {
    return []
  }
  return plan.steps.filter((step) => step.status !== 'success' && step.status !== 'skipped')
}

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

/**
 * 按 Agent 权限模式算出「需要人工确认或被拦截」的待执行步骤。
 *
 * - full-access：[]（全部放行）
 * - smart / auto-edit：仅高风险步骤（与旧行为一致）
 * - ask：任何中高风险或要调用工具的步骤
 * - plan-only：除纯只读（无工具且低风险）外的全部步骤
 */
export function stepsRequiringApproval(
  plan: PlanViewDto | null | undefined,
  mode: AgentPermissionMode = 'smart'
): string[] {
  const pending = pendingSteps(plan)
  switch (mode) {
    case 'full-access':
      return []
    case 'ask':
      return pending
        .filter((step) => step.requiresConfirmation || step.risk !== 'low' || step.tool !== null)
        .map((step) => step.id)
    case 'plan-only':
      return pending
        .filter((step) => !(step.tool === null && step.risk === 'low'))
        .map((step) => step.id)
    case 'smart':
    case 'auto-edit':
    default:
      return pending.filter((step) => step.requiresConfirmation).map((step) => step.id)
  }
}

/** full-access 下可以自动放行的待执行步骤；其它模式一律空数组。 */
export function autoConfirmedStepIdsForMode(
  plan: PlanViewDto | null | undefined,
  mode: AgentPermissionMode = 'smart'
): string[] {
  if (mode !== 'full-access') {
    return []
  }
  return pendingSteps(plan).map((step) => step.id)
}
