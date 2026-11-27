// ai/agent/plan —— Plan 协议：计划对象的结构、校验与状态推进。
//
// 协议定义在 docs/02 §B2。三条不可让步的规则在这里落成代码：
// 1. 每一步必须带可判断的 `expect`——没有验收方式的步骤不许进计划；
// 2. 必须有停止条件——无法叫停的计划不允许执行；
// 3. 推进状态是纯函数，产出新对象——计划一旦给出，历史版本不被就地改写。
//
// 本文件不调模型、不落库、不做权限判断（权限属于策略层）。

import type { AgentPermissionMode } from '../../../shared/types/ipc.ts'

export type PlanRisk = 'low' | 'mid' | 'high'
export type PlanStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export const PLAN_RISKS: readonly PlanRisk[] = ['low', 'mid', 'high']

export interface PlanStepDraft {
  /** 缺省时按顺序自动补成 '1'、'2'… */
  id?: string
  action: string
  /** 预期使用的工具名；为空表示这步不调工具。 */
  tool?: string | null
  input?: unknown
  expect: string
  risk?: PlanRisk
}

export interface PlanStep {
  id: string
  action: string
  tool: string | null
  input: unknown
  expect: string
  risk: PlanRisk
  status: PlanStepStatus
}

export interface PlanCostEstimate {
  tokens: number
  wallClockSec: number
}

export interface PlanDraft {
  goal: string
  assumptions?: string[]
  steps: PlanStepDraft[]
  stopConditions?: string[]
  rollback?: string
  costEstimate?: PlanCostEstimate
}

export interface Plan {
  goal: string
  assumptions: string[]
  steps: PlanStep[]
  stopConditions: string[]
  rollback: string
  costEstimate: PlanCostEstimate
  createdAt: string
}

export type Validation<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export function validatePlanDraft(draft: PlanDraft): Validation<Plan> {
  const errors: string[] = []

  const goal = (draft.goal ?? '').trim()
  if (goal === '') {
    errors.push('E_GOAL_REQUIRED')
  }

  const steps = draft.steps ?? []
  if (steps.length === 0) {
    errors.push('E_STEPS_REQUIRED')
  }

  const seenIds = new Set<string>()
  const normalizedSteps: PlanStep[] = steps.map((raw, index) => {
    const id = (raw.id ?? String(index + 1)).trim()
    if (id === '') {
      errors.push('E_STEP_ID_REQUIRED')
    }
    if (seenIds.has(id)) {
      errors.push('E_STEP_ID_DUPLICATE')
    }
    seenIds.add(id)

    const expect = (raw.expect ?? '').trim()
    if (expect === '') {
      errors.push('E_STEP_EXPECT_REQUIRED')
    }

    const action = (raw.action ?? '').trim()
    if (action === '') {
      errors.push('E_STEP_ACTION_REQUIRED')
    }

    const risk = raw.risk ?? 'low'
    if (!PLAN_RISKS.includes(risk)) {
      errors.push('E_STEP_BAD_RISK')
    }

    return {
      id,
      action,
      tool: raw.tool ?? null,
      input: raw.input ?? null,
      expect,
      risk,
      status: 'pending' as PlanStepStatus
    }
  })

  const stopConditions = (draft.stopConditions ?? []).map((item) => item.trim()).filter(Boolean)
  if (stopConditions.length === 0) {
    errors.push('E_STOP_REQUIRED')
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    value: {
      goal,
      assumptions: (draft.assumptions ?? []).map((item) => item.trim()).filter(Boolean),
      steps: normalizedSteps,
      stopConditions,
      rollback: (draft.rollback ?? '').trim(),
      costEstimate: {
        tokens: draft.costEstimate?.tokens ?? 0,
        wallClockSec: draft.costEstimate?.wallClockSec ?? 0
      },
      createdAt: ''
    }
  }
}

/** 构造计划；非法草稿直接抛错，不生成半成品。 */
export function createPlan(draft: PlanDraft, context: { now: string }): Plan {
  const checked = validatePlanDraft(draft)
  if (!checked.ok) {
    throw new Error(`E_INVALID_PLAN: ${checked.errors.join(',')}`)
  }
  return { ...checked.value, createdAt: context.now }
}

/** 推进某一步的状态，返回新计划；id 不存在时抛错，避免静默写坏状态。 */
export function markStep(plan: Plan, stepId: string, status: PlanStepStatus): Plan {
  const index = plan.steps.findIndex((step) => step.id === stepId)
  if (index < 0) {
    throw new Error(`E_STEP_NOT_FOUND: ${stepId}`)
  }
  const steps = [...plan.steps]
  steps[index] = { ...steps[index], status }
  return { ...plan, steps }
}

export interface PlanProgress {
  total: number
  pending: number
  running: number
  success: number
  failed: number
  skipped: number
}

export function summarizeProgress(plan: Plan): PlanProgress {
  const progress: PlanProgress = {
    total: plan.steps.length,
    pending: 0,
    running: 0,
    success: 0,
    failed: 0,
    skipped: 0
  }
  for (const step of plan.steps) {
    progress[step.status] += 1
  }
  return progress
}

/** 需要先问人的步骤：按权限模式决定，而不是只看 risk。 */
export function needsConfirmation(
  plan: Plan,
  mode: AgentPermissionMode = 'smart'
): PlanStep[] {
  return plan.steps.filter((step) => stepNeedsConfirmation(step, mode))
}

/**
 * 单步的确认门。默认 smart 与旧行为一致（只拦 risk=high）；
 * 更严格的模式按 risk / 是否带工具扩大范围。
 */
export function stepNeedsConfirmation(
  step: Pick<PlanStep, 'risk' | 'tool'>,
  mode: AgentPermissionMode = 'smart'
): boolean {
  switch (mode) {
    case 'full-access':
      return false
    case 'plan-only':
    case 'ask':
      // 逐次确认 / 仅规划：任何带工具的步骤、或中高风险，都要先问
      return step.tool !== null || step.risk !== 'low'
    case 'auto-edit':
      // 内置工具还没有写文件 / 执行命令能力：在写工具落地前，这一档与 smart 等价
      return step.risk === 'high'
    case 'smart':
    default:
      return step.risk === 'high'
  }
}
