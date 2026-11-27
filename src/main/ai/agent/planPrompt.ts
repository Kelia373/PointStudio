// ai/agent/planPrompt —— 让模型按 Plan 协议输出计划。
//
// 分两半：
// 1. buildPlanPrompt：把目标与「这个工作台会什么」写进提示词；
// 2. parsePlanResponse：从模型输出里抠出 JSON，再走 validatePlanDraft。
//
// 关键取向：**模型输出不可信**。不假设它是干净 JSON，也不假设字段齐——
// 解析失败给错误码，结构不合协议就把协议错误码原样带出去，
// 让上层决定重试还是让用户改目标。
import { validatePlanDraft, type Plan, type PlanDraft } from './plan.ts'

export interface CapabilitySummary {
  name: string
  description: string
  sideEffect: string
  requiresApproval: boolean
  params: string[]
}

export type ParseResult = { ok: true; value: PlanDraft } | { ok: false; errors: string[] }

const PROTOCOL_SPEC = `输出一个 JSON 对象，字段如下：
{
  "goal": "可验收的目标陈述",
  "assumptions": ["把不确定的地方写成假设"],
  "steps": [
    { "id": "1", "action": "干什么", "tool": "工具名或 null", "input": {}, "expect": "怎么判断成功", "risk": "low|mid|high" }
  ],
  "stopConditions": ["什么情况下必须停下来"],
  "rollback": "失败了怎么退"
}
硬性要求：
1. 每一步的 expect 必须能被判断真假，写"处理好""优化一下"不算；
2. steps 不能为空，stopConditions 至少一条；
3. 涉及写文件、花钱、对外发送的步骤，risk 必须写 high；
4. 只输出 JSON，不要输出解释文字。`

export function buildPlanPrompt(goal: string, capabilities: CapabilitySummary[]): string {
  const toolLines =
    capabilities.length === 0
      ? '（当前没有可用工具，所有步骤请把 tool 设为 null）'
      : capabilities
          .map((tool) => {
            const params = tool.params.length > 0 ? `参数: ${tool.params.join(', ')}` : '无参数'
            const approval = tool.requiresApproval ? '（执行前需要人确认）' : ''
            return `- ${tool.name}（副作用: ${tool.sideEffect}${approval}）${tool.description}；${params}`
          })
          .join('\n')

  return `你是任务规划器。请把下面的目标拆成可执行的计划。

目标：${goal}

可用工具：
${toolLines}

${PROTOCOL_SPEC}`
}

/** 取出文本里所有「括号平衡」的片段；模型输出可能夹着解释文字与花括号。 */
function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = []
  let index = 0

  while (index < text.length) {
    const start = text.indexOf('{', index)
    if (start < 0) {
      break
    }

    let depth = 0
    let inString = false
    let escaped = false
    let end = -1

    for (let cursor = start; cursor < text.length; cursor += 1) {
      const char = text[cursor]
      if (inString) {
        if (escaped) {
          escaped = false
        } else if (char === '\\') {
          escaped = true
        } else if (char === '"') {
          inString = false
        }
        continue
      }
      if (char === '"') {
        inString = true
      } else if (char === '{') {
        depth += 1
      } else if (char === '}') {
        depth -= 1
        if (depth === 0) {
          end = cursor
          break
        }
      }
    }

    if (end < 0) {
      break
    }
    candidates.push(text.slice(start, end + 1))
    index = end + 1
  }

  return candidates
}

export function parsePlanResponse(text: string): ParseResult {
  const candidates = extractJsonCandidates(text)
  if (candidates.length === 0) {
    return { ok: false, errors: ['E_PLAN_JSON_INVALID'] }
  }

  // 逐个候选尝试：模型常把「示例」「说明」里的花括号也吐出来，
  // 取第一个能解析且合协议的，比盲取第一个平衡块可靠。
  let protocolErrors: string[] | null = null

  for (const candidate of candidates) {
    let parsed: unknown
    try {
      parsed = JSON.parse(candidate)
    } catch {
      continue
    }

    const draft = parsed as PlanDraft
    const checked = validatePlanDraft({
      goal: typeof draft.goal === 'string' ? draft.goal : '',
      assumptions: Array.isArray(draft.assumptions) ? draft.assumptions : [],
      steps: Array.isArray(draft.steps) ? draft.steps : [],
      stopConditions: Array.isArray(draft.stopConditions) ? draft.stopConditions : [],
      rollback: typeof draft.rollback === 'string' ? draft.rollback : '',
      costEstimate: draft.costEstimate
    })

    if (!checked.ok) {
      protocolErrors = checked.errors
      continue
    }

    const plan: Plan = checked.value
    return {
      ok: true,
      value: {
        goal: plan.goal,
        assumptions: plan.assumptions,
        steps: plan.steps.map((step) => ({
          id: step.id,
          action: step.action,
          tool: step.tool,
          input: step.input,
          expect: step.expect,
          risk: step.risk
        })),
        stopConditions: plan.stopConditions,
        rollback: plan.rollback,
        costEstimate: plan.costEstimate
      }
    }
  }

  // 解析出了 JSON 但都不合协议 → 把协议错误带回去（上层可据此重试）；
  // 一个都解析不出来 → 当作格式错误。
  return { ok: false, errors: protocolErrors ?? ['E_PLAN_JSON_INVALID'] }
}
