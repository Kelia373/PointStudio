// services/backupService —— 整库导出与恢复。
//
// 直接用存储对象而不是业务服务：恢复必须**原样保留 id 与时间戳**，
// 走 create/append 会重新生成 id、改写时间，恢复出来的就不是同一份数据了。
//
// 安全前提：**先校验、后写入**。校验不过时一个字节都不落地，
// 否则「恢复失败」会变成「把现有数据也弄坏了」。
import {
  createBackup,
  parseBackup,
  summarizeBackup,
  type BackupDocument
} from '../ai/domain/backup.ts'
import type { Assistant } from '../ai/domain/assistant.ts'
import type { Conversation, Message } from '../ai/domain/conversation.ts'
import type { JsonFileStore } from '../data/fileStore.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export type RestoreMode = 'replace' | 'merge'

export interface RestoreCounts {
  added: number
  skipped: number
}

export interface BackupServiceDeps {
  now: () => string
}

export class BackupService {
  private readonly conversations: JsonFileStore<Conversation>
  private readonly messages: JsonFileStore<Message>
  private readonly assistants: JsonFileStore<Assistant>
  private readonly deps: BackupServiceDeps

  constructor(
    conversations: JsonFileStore<Conversation>,
    messages: JsonFileStore<Message>,
    assistants: JsonFileStore<Assistant>,
    deps: BackupServiceDeps
  ) {
    this.conversations = conversations
    this.messages = messages
    this.assistants = assistants
    this.deps = deps
  }

  async export(): Promise<BackupDocument> {
    const [conversations, messages, assistants] = await Promise.all([
      this.conversations.readAll(),
      this.messages.readAll(),
      this.assistants.readAll()
    ])
    return createBackup({ conversations, messages, assistants }, { now: this.deps.now() })
  }

  /** 序列化成可直接写文件的字符串（缩进 2，便于人眼检查与 diff）。 */
  async exportToText(): Promise<string> {
    const doc = await this.export()
    return `${JSON.stringify(doc, null, 2)}\n`
  }

  async restore(input: BackupDocument | string, mode: RestoreMode = 'replace'): Promise<ServiceResult<RestoreCounts | true>> {
    const text = typeof input === 'string' ? input : JSON.stringify(input)
    const parsed = parseBackup(text)
    if (!parsed.ok) {
      return { ok: false, errors: parsed.errors }
    }
    const doc = parsed.value

    if (mode === 'replace') {
      await this.conversations.writeAll(doc.conversations)
      await this.messages.writeAll(doc.messages)
      await this.assistants.writeAll(doc.assistants)
      return { ok: true, value: true }
    }

    const counts: RestoreCounts = { added: 0, skipped: 0 }
    counts.skipped += await this.mergeInto(this.conversations, doc.conversations)
    counts.skipped += await this.mergeInto(this.messages, doc.messages)
    counts.skipped += await this.mergeInto(this.assistants, doc.assistants)
    counts.added =
      doc.conversations.length + doc.messages.length + doc.assistants.length - counts.skipped
    return { ok: true, value: counts }
  }

  /** 按 id 去重合并：已存在的跳过，绝不覆盖（覆盖会丢用户后来改的内容）。 */
  private async mergeInto<T extends { id: string }>(
    store: JsonFileStore<T>,
    incoming: T[]
  ): Promise<number> {
    const existing = await store.readAll()
    const seen = new Set(existing.map((item) => item.id))
    let skipped = 0
    for (const item of incoming) {
      if (seen.has(item.id)) {
        skipped += 1
        continue
      }
      existing.push(item)
      seen.add(item.id)
    }
    await store.writeAll(existing)
    return skipped
  }

  summarize(doc: BackupDocument): ReturnType<typeof summarizeBackup> {
    return summarizeBackup(doc)
  }
}
