// services/usageLedgerService —— 本地 Token 账本的读写。
//
// 记录来自真实流式响应的尾帧 usage；没有 usage 的调用不记（不估算、不编数字）。
// 文件有上限，超出后丢最旧的，避免长期使用把 userData 撑大。
import {
  summarizeUsageLedger,
  type UsageLedgerRecord,
  type UsageLedgerSummary
} from '../ai/domain/usageLedger.ts'
import type { JsonFileStore } from '../data/fileStore.ts'
import type { UsageRangeDto } from '../../shared/types/ipc.ts'

export interface UsageLedgerServiceDeps {
  now: () => string
  newId: () => string
  /** 保留上限，默认 5000 条。 */
  maxRecords?: number
}

export type UsageRecordInput = Omit<UsageLedgerRecord, 'id' | 'at'>

export const DEFAULT_MAX_RECORDS = 5_000

export class UsageLedgerService {
  private readonly store: JsonFileStore<UsageLedgerRecord>
  private readonly deps: UsageLedgerServiceDeps
  /** 写队列：多个 Agent 同时收尾时按顺序写，避免 read-modify-write 互相覆盖。 */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(store: JsonFileStore<UsageLedgerRecord>, deps: UsageLedgerServiceDeps) {
    this.store = store
    this.deps = deps
  }

  record(input: UsageRecordInput): Promise<UsageLedgerRecord> {
    const task = this.queue.then(() => this.write(input))
    this.queue = task.then(
      () => undefined,
      () => undefined
    )
    return task
  }

  private async write(input: UsageRecordInput): Promise<UsageLedgerRecord> {
    const record: UsageLedgerRecord = {
      ...input,
      id: this.deps.newId(),
      at: this.deps.now()
    }
    const items = await this.store.readAll()
    const next = [...items, record]
    const max = this.deps.maxRecords ?? DEFAULT_MAX_RECORDS
    await this.store.writeAll(next.length > max ? next.slice(next.length - max) : next)
    return record
  }

  async summary(range: UsageRangeDto, now = new Date(this.deps.now())): Promise<UsageLedgerSummary> {
    return summarizeUsageLedger(await this.store.readAll(), range, now)
  }

  async readAll(): Promise<UsageLedgerRecord[]> {
    return [...(await this.store.readAll())]
  }
}
