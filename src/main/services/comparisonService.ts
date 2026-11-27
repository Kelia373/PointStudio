// services/comparisonService —— 同一问题并行问多个平台，结果并排比较。
//
// 只做编排：每个目标用自己的 provider / 模型 / 凭据，互不串台。
// 并行执行，单个失败被隔离——对比的价值在于"看到差异"，
// 不能因为一家报错就整个对比失败。
import type { ChatProvider } from '../ai/providers/types.ts'
import { streamReplyText } from './chatEngine.ts'

export interface ComparisonTarget {
  /** 结果里的标识，通常用平台名。 */
  id: string
  /** 给人看的名字。 */
  label: string
  provider: ChatProvider
  model: string
  baseUrl: string
  apiKey: string | null
}

export interface ComparisonOutcome {
  targetId: string
  label: string
  status: 'success' | 'error'
  text: string
  error?: string
  durationMs: number
}

async function runOne(question: string, target: ComparisonTarget): Promise<ComparisonOutcome> {
  const started = Date.now()
  let text = ''
  try {
    for await (const chunk of streamReplyText(question, {
      provider: target.provider,
      apiKey: target.apiKey,
      baseUrl: target.baseUrl,
      model: target.model
    })) {
      text += chunk
    }
    return {
      targetId: target.id,
      label: target.label,
      status: 'success',
      text,
      durationMs: Date.now() - started
    }
  } catch (error) {
    return {
      targetId: target.id,
      label: target.label,
      status: 'error',
      // 失败时不保留半截文本：对比里半截答案比没有答案更容易误导。
      text: '',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started
    }
  }
}

export async function compareAcross(
  question: string,
  targets: ComparisonTarget[]
): Promise<ComparisonOutcome[]> {
  if (targets.length === 0) {
    return []
  }
  // allSettled 语义：任何一家抛错都在 runOne 内部被吃掉，不会中断其他家。
  return Promise.all(targets.map((target) => runOne(question, target)))
}
