// lib/pandaRouter —— 难度估计与升级阶梯（HeuristicPanda 的本地实现）。
//
// 先按启发式判断这一题有多难，再给出「从便宜模型到强模型」的阶梯。
// 纯函数：不碰网络、不碰 store，方便单测与将来搬到主进程。

export type DifficultyLevel = 1 | 2 | 3
export type DifficultyCategory = 'chat' | 'code' | 'reasoning'

export interface DifficultyEstimate {
  level: DifficultyLevel
  category: DifficultyCategory
}

export interface RouteLadderStep {
  model: string
  pSuccess: number
  estCostUsd?: number
}

export type RouteLadder = RouteLadderStep[]

const CODE_HINT = /```|\bfunction\b|\bclass\b|\bconst\b|\bimport\b|\binterface\b|报错|编译|重构|单测|测试/
const STEP_HINT = /(先|然后|接着|最后|步骤|拆|清单|验收)/
/** 超过这个长度，即便没触发其他信号，也不再当闲聊。 */
const LONG_TEXT = 200
/** 有步骤词的短句也算中等，避免把「先…然后…」当成闲聊。 */
const STEP_MIN_LENGTH = 24

export function estimateDifficulty(text: string): DifficultyEstimate {
  const normalized = (text ?? '').trim()
  const length = normalized.length
  const hasCode = CODE_HINT.test(normalized)
  const hasSteps = STEP_HINT.test(normalized)

  if (hasCode && (hasSteps || length > 120)) {
    return { level: 3, category: 'code' }
  }
  if (hasCode) {
    return { level: 2, category: 'code' }
  }
  if ((hasSteps && length > STEP_MIN_LENGTH) || length > LONG_TEXT) {
    return { level: 2, category: 'reasoning' }
  }
  return { level: 1, category: 'chat' }
}

/**
 * 阶梯长度 = 难度等级：简单只走一步，困难预留三级升级。
 * 成功率单调上升、成本单调上升——否则「升级」就没有意义。
 */
export function buildEscalationLadder(level: DifficultyLevel, models: string[]): RouteLadder {
  return models.slice(0, level).map((model, index) => ({
    model,
    pSuccess: Math.min(0.95, 0.6 + index * 0.12),
    estCostUsd: Number((0.002 * 5 ** index).toFixed(4))
  }))
}

/** 当前是第 attempt 级，返回下一级；到底返回 null。 */
export function nextAttempt(ladder: RouteLadder, attempt: number): RouteLadderStep | null {
  return ladder[attempt + 1] ?? null
}

export interface RouteTickInput {
  level: DifficultyLevel
  category: DifficultyCategory
  model: string
  confidence: number
}

/** 徽章文案：L2 · code · claude-sonnet · 78% */
export function formatRouteTick(input: RouteTickInput): string {
  const percent = Math.round(input.confidence * 100)
  return `L${input.level} · ${input.category} · ${input.model} · ${percent}%`
}
