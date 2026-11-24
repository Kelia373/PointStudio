// 输入栏的模型 / 思考等级选项：纯数据 + 纯换算，便于单测。
//
// 「思考等级」不是玄学：它映射成这一轮的最大输出长度预算。
// 低 = 1k、中 = 2k、高 = 4k。会话里只存 maxTokens，等级由它反推，
// 这样数据层不需要多一个概念，也不会出现「等级与预算不一致」。
export type Effort = 'low' | 'mid' | 'high'

export const EFFORT_MAX_TOKENS: Record<Effort, number> = {
  low: 1024,
  mid: 2048,
  high: 4096
}

export const EFFORT_LABEL: Record<Effort, string> = {
  low: '低',
  mid: '中',
  high: '高'
}

/** 反推等级：没设过或不在预设上，返回 null（界面显示「默认」）。 */
export function effortFromMaxTokens(maxTokens: number | undefined): Effort | null {
  if (maxTokens === undefined) {
    return null
  }
  const found = (Object.keys(EFFORT_MAX_TOKENS) as Effort[]).find(
    (effort) => EFFORT_MAX_TOKENS[effort] === maxTokens
  )
  return found ?? null
}

/** 各平台常见模型名。只用于下拉建议，不限制手输。 */
const MODELS_BY_PROVIDER: Record<string, string[]> = {
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  ollama: ['llama3.1', 'qwen2.5', 'mistral']
}

/**
 * 下拉里要显示的模型名：平台预设 + 当前值（当前值可能不在预设里，比如手输的）。
 * 去重并保持顺序，第一项永远是当前值。
 */
export function modelChoices(
  providerId: string | null,
  current: string | null | undefined
): string[] {
  const presets = providerId ? (MODELS_BY_PROVIDER[providerId] ?? []) : []
  const head = current && current !== '' ? [current] : []
  const rest = presets.filter((model) => !head.includes(model))
  return [...head, ...rest]
}
