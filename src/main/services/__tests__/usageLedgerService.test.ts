// 契约测试：Token 账本服务（写入 / 聚合 / 上限裁剪）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { UsageLedgerService } from '../usageLedgerService.ts'
import type { UsageLedgerRecord } from '../../ai/domain/usageLedger.ts'

async function withService(
  run: (ctx: { service: UsageLedgerService; reopen: () => UsageLedgerService }) => Promise<void>,
  maxRecords?: number
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-ledger-'))
  const filePath = join(dir, 'usage-ledger.json')
  let seq = 0
  const build = (): UsageLedgerService =>
    new UsageLedgerService(new JsonFileStore<UsageLedgerRecord>(filePath), {
      now: () => `2026-02-10T0${seq % 10}:00:00.000Z`,
      newId: () => `u-${++seq}`,
      ...(maxRecords !== undefined ? { maxRecords } : {})
    })
  try {
    await run({ service: build(), reopen: build })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('记录一次调用后可聚合，重启后还在', async () => {
  await withService(async ({ service, reopen }) => {
    await service.record({
      providerId: 'deepseek',
      modelId: 'deepseek-chat',
      assistantId: null,
      conversationId: 'c1',
      promptTokens: 10,
      completionTokens: 4,
      cacheHitTokens: 0,
      totalTokens: 14
    })
    const summary = await reopen().summary('all')
    assert.equal(summary.totalCalls, 1)
    assert.equal(summary.totalTokens, 14)
    assert.equal(summary.byProvider[0].key, 'deepseek')
  })
})

test('按时间窗聚合：today 不含昨天的记录', async () => {
  await withService(async ({ service }) => {
    await service.record({
      providerId: 'deepseek',
      modelId: 'm',
      assistantId: 'a1',
      conversationId: 'c1',
      promptTokens: 1,
      completionTokens: 1,
      cacheHitTokens: 0,
      totalTokens: 2
    })
    const summary = await service.summary('today', new Date('2026-02-09T00:30:00.000Z'))
    assert.equal(summary.totalCalls, 0)
    const all = await service.summary('all')
    assert.equal(all.totalCalls, 1)
  })
})

test('超过上限时丢最旧的记录', async () => {
  await withService(
    async ({ service }) => {
      for (let i = 0; i < 5; i++) {
        await service.record({
          providerId: 'deepseek',
          modelId: 'm',
          assistantId: null,
          conversationId: `c${i}`,
          promptTokens: 1,
          completionTokens: 1,
          cacheHitTokens: 0,
          totalTokens: 2
        })
      }
      const records = await service.readAll()
      assert.equal(records.length, 3)
      assert.deepEqual(
        records.map((item) => item.conversationId),
        ['c2', 'c3', 'c4']
      )
    },
    3
  )
})
