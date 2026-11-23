// services/planService —— 让模型生成计划：拼提示词 → 调模型 → 解析 → 校验 → 带错重试。
//
// 这一层是「计划生成」的编排，不含协议规则（在 ai/agent/plan.ts）也不含解析细节
// （在 ai/agent/planPrompt.ts）。它只决定：问几次、失败怎么带反馈。
import {
  buildPlanPrompt,
  parsePlanResponse
} from '../ai/agent/planPrompt.ts'
import { createPlan, type Plan } from '../ai/agent/plan.ts'
import type { ToolRegistry } from '../ai/tools/registry.ts'
import { streamReplyText, type ChatEngineDeps } from './chatEngine.ts'

/** 与仓库其余 ServiceResult 保持同一形状：成功给 value，失败给 errors。 */
export type GeneratePlanResult =
  | { ok: true; value: Plan }
  | { ok: false; errors: string[] }

export interface GeneratePlanDeps {
  engine: ChatEngineDeps
  tools: ToolRegistry
  now: () => string
  /** 最多问几次模型，默认 2（一次原始 + 一次带错误反馈）。 */
  maxAttempts?: number
}

/** 问模型直到拿到合格计划；generate 与 replan 共用这段重试逻辑。 */
async function requestPlan(basePrompt: string, deps: GeneratePlanDeps): Promise<GeneratePlanResult> {
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 2)
  let lastErrors: string[] = ['E_PLAN_UNKNOWN']

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const prompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\n上一次的输出不符合协议，错误码：${lastErrors.join(', ')}。请修正后重新输出完整 JSON。`

    let text = ''
    for await (const chunk of streamReplyText(prompt, deps.engine)) {
      text += chunk
    }

    const parsed = parsePlanResponse(text)
    if (parsed.ok) {
      // createdAt 由这里注入：解析器不碰时间，回放才可复现。
      return { ok: true, value: createPlan(parsed.value, { now: deps.now() }) }
    }

    lastErrors = parsed.errors
  }

  return { ok: false, errors: lastErrors }
}

export async function generatePlan(
  goal: string,
  deps: GeneratePlanDeps
): Promise<GeneratePlanResult> {
  return requestPlan(buildPlanPrompt(goal, deps.tools.describe()), deps)
}

export interface ReplanInput {
  /** 失败时的计划快照。 */
  plan: Plan
  failedStepId: string
  /** 失败原因（通常是工具错误码）。 */
  errorCode: string
}

/**
 * 失败后重规划：把失败现场交给模型，让它给出修订版计划。
 *
 * 注意职责边界：这里只负责「问出修订版」，不负责丢掉旧计划——
 * 旧计划仍由调用方保存，重规划产生的是新对象（可回放、可对比）。
 */
export async function replanAfterFailure(
  input: ReplanInput,
  deps: GeneratePlanDeps
): Promise<GeneratePlanResult> {
  const failed = input.plan.steps.find((step) => step.id === input.failedStepId)
  const base = buildPlanPrompt(input.plan.goal, deps.tools.describe())

  const failureContext = [
    '',
    '下面是上一次的计划，它在执行中失败了：',
    JSON.stringify(
      {
        goal: input.plan.goal,
        steps: input.plan.steps.map((step) => ({
          id: step.id,
          action: step.action,
          tool: step.tool,
          expect: step.expect,
          risk: step.risk,
          status: step.status
        })),
        stopConditions: input.plan.stopConditions
      },
      null,
      2
    ),
    `失败步骤：${input.failedStepId}${failed ? `（${failed.action}）` : ''}`,
    `失败原因：${input.errorCode}`,
    '请给出修订后的完整计划：保留已完成的部分，调整失败步骤及其后续；仍然是同一个 JSON 协议。'
  ].join('\n')

  return requestPlan(base + failureContext, deps)
}
