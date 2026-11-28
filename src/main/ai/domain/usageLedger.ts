// ai/domain/usageLedger —— 本地 Token 账本的纯聚合逻辑。
//
// 只处理数组与时间窗，不碰文件、不碰 fetch：这样聚合规则可以被单测钉死，
// 服务层只负责读写与裁剪。
import type { UsageBucketDto, UsageRangeDto } from '../../../shared/types/ipc.ts'

export interface UsageLedgerRecord {
  id: string
  /** ISO 时间戳。 */
  at: string
  providerId: string
  modelId: string
  /** 普通对话为 null；驻场 Agent 的调用记录其 id。 */
  assistantId: string | null
  conversationId: string
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  totalTokens: number
}

export interface UsageLedgerSummary {
  range: UsageRangeDto
  totalCalls: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCacheHitTokens: number
  totalTokens: number
  byProvider: UsageBucketDto[]
  byAssistant: UsageBucketDto[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** 时间窗起点：today 按本地自然日，7d / 30d 按滚动窗口，all 不设下限。 */
export function rangeStart(range: UsageRangeDto, now: Date): number | null {
  if (range === 'all') {
    return null
  }
  if (range === 'today') {
    const start = new Date(now.getTime())
    start.setHours(0, 0, 0, 0)
    return start.getTime()
  }
  const days = range === '7d' ? 7 : 30
  return now.getTime() - days * DAY_MS
}

function emptyBucket(key: string): UsageBucketDto {
  return {
    key,
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheHitTokens: 0,
    totalTokens: 0
  }
}

function accumulate(bucket: UsageBucketDto, record: UsageLedgerRecord): void {
  bucket.calls += 1
  bucket.promptTokens += record.promptTokens
  bucket.completionTokens += record.completionTokens
  bucket.cacheHitTokens += record.cacheHitTokens
  bucket.totalTokens += record.totalTokens
}

function sortBuckets(buckets: UsageBucketDto[]): UsageBucketDto[] {
  return [...buckets].sort(
    (a, b) => b.totalTokens - a.totalTokens || a.key.localeCompare(b.key)
  )
}

/** 先按时间窗过滤，再按服务商与助手两个维度聚合；排序稳定（总量降序，同量按 key）。 */
export function summarizeUsageLedger(
  records: readonly UsageLedgerRecord[],
  range: UsageRangeDto,
  now: Date
): UsageLedgerSummary {
  const start = rangeStart(range, now)
  const inRange = records.filter((record) => {
    if (start === null) {
      return true
    }
    const at = Date.parse(record.at)
    return Number.isFinite(at) && at >= start && at <= now.getTime()
  })

  const byProvider = new Map<string, UsageBucketDto>()
  const byAssistant = new Map<string, UsageBucketDto>()
  let totalPromptTokens = 0
  let totalCompletionTokens = 0
  let totalCacheHitTokens = 0
  let totalTokens = 0

  for (const record of inRange) {
    const provider = byProvider.get(record.providerId) ?? emptyBucket(record.providerId)
    accumulate(provider, record)
    byProvider.set(record.providerId, provider)

    const assistantKey = record.assistantId ?? 'direct'
    const assistant = byAssistant.get(assistantKey) ?? emptyBucket(assistantKey)
    accumulate(assistant, record)
    byAssistant.set(assistantKey, assistant)

    totalPromptTokens += record.promptTokens
    totalCompletionTokens += record.completionTokens
    totalCacheHitTokens += record.cacheHitTokens
    totalTokens += record.totalTokens
  }

  return {
    range,
    totalCalls: inRange.length,
    totalPromptTokens,
    totalCompletionTokens,
    totalCacheHitTokens,
    totalTokens,
    byProvider: sortBuckets([...byProvider.values()]),
    byAssistant: sortBuckets([...byAssistant.values()])
  }
}
