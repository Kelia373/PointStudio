// 契约测试：本地 Token 账本的聚合规则与时间窗。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { rangeStart, summarizeUsageLedger, type UsageLedgerRecord } from '../usageLedger.ts'

function record(
  overrides: Partial<UsageLedgerRecord> & { at: string; providerId: string }
): UsageLedgerRecord {
  return {
    id: `r-${overrides.at}-${overrides.providerId}`,
    modelId: 'm',
    assistantId: null,
    conversationId: 'c1',
    promptTokens: 10,
    completionTokens: 5,
    cacheHitTokens: 0,
    totalTokens: 15,
    ...overrides
  }
}

const NOW = new Date('2026-02-10T12:00:00.000Z')

test('按服务商与助手双维度聚合，普通对话归到 direct', () => {
  const summary = summarizeUsageLedger(
    [
      record({ at: '2026-02-10T10:00:00.000Z', providerId: 'deepseek', assistantId: 'a1' }),
      record({
        at: '2026-02-10T11:00:00.000Z',
        providerId: 'opencode-go',
        assistantId: 'a2',
        promptTokens: 20,
        completionTokens: 10,
        cacheHitTokens: 4,
        totalTokens: 30
      }),
      record({ at: '2026-02-10T11:30:00.000Z', providerId: 'deepseek', assistantId: null })
    ],
    'all',
    NOW
  )

  assert.equal(summary.totalCalls, 3)
  assert.equal(summary.totalPromptTokens, 40)
  assert.equal(summary.totalCompletionTokens, 20)
  assert.equal(summary.totalCacheHitTokens, 4)
  assert.equal(summary.totalTokens, 60)

  assert.deepEqual(
    summary.byProvider.map((item) => [item.key, item.calls, item.totalTokens]),
    [
      ['deepseek', 2, 30],
      ['opencode-go', 1, 30]
    ]
  )
  assert.deepEqual(
    summary.byAssistant.map((item) => [item.key, item.calls]),
    [
      ['a2', 1],
      ['a1', 1],
      ['direct', 1]
    ]
  )
})

test('today 只算本地自然日；7d / 30d 是滚动窗口', () => {
  const todayStart = rangeStart('today', new Date('2026-02-10T12:00:00'))
  assert.equal(new Date(todayStart ?? 0).getHours(), 0)
  assert.equal(new Date(todayStart ?? 0).getDate(), 10)

  const records = [
    record({ at: '2026-02-10T08:00:00.000Z', providerId: 'deepseek' }),
    record({ at: '2026-02-05T08:00:00.000Z', providerId: 'deepseek' }),
    record({ at: '2026-01-20T08:00:00.000Z', providerId: 'deepseek' })
  ]
  assert.equal(summarizeUsageLedger(records, 'today', NOW).totalCalls, 1)
  assert.equal(summarizeUsageLedger(records, '7d', NOW).totalCalls, 2)
  assert.equal(summarizeUsageLedger(records, '30d', NOW).totalCalls, 3)
  assert.equal(summarizeUsageLedger(records, 'all', NOW).totalCalls, 3)
})

test('窗口外的记录被严格排除，不按天四舍五入', () => {
  const records = [
    record({ at: '2026-02-03T12:00:01.000Z', providerId: 'deepseek' }),
    record({ at: '2026-02-03T11:59:59.000Z', providerId: 'deepseek' })
  ]
  const seven = summarizeUsageLedger(records, '7d', NOW)
  assert.equal(seven.totalCalls, 1)
})

test('空账本返回全零而不是 undefined', () => {
  const summary = summarizeUsageLedger([], 'today', NOW)
  assert.equal(summary.totalCalls, 0)
  assert.equal(summary.totalTokens, 0)
  assert.deepEqual(summary.byProvider, [])
  assert.deepEqual(summary.byAssistant, [])
})
