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

export async function generatePlan(
  goal: string,
  deps: GeneratePlanDeps
): Promise<GeneratePlanResult> {
  const maxAttempts = Math.max(1, deps.maxAttempts ?? 2)
  const basePrompt = buildPlanPrompt(goal, deps.tools.describe())

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
