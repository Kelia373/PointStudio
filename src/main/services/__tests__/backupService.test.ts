// 契约测试：备份服务（导出、恢复、合并、失败不落地）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { BackupService } from '../backupService.ts'
import { createBackup, BACKUP_VERSION } from '../../ai/domain/backup.ts'
import type { Assistant } from '../../ai/domain/assistant.ts'
import type { Conversation, Message } from '../../ai/domain/conversation.ts'

const NOW = '2026-01-01T00:00:00.000Z'

interface Fixture {
  service: BackupService
  seed: (ids: { conversation: string; message: string; assistant: string }) => Promise<void>
  counts: () => Promise<{ conversations: number; messages: number; assistants: number }>
}

async function withBackup(run: (ctx: Fixture) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-backup-'))
  const conversationStore = new JsonFileStore<Conversation>(join(dir, 'conversations.json'))
  const messageStore = new JsonFileStore<Message>(join(dir, 'messages.json'))
  const assistantStore = new JsonFileStore<Assistant>(join(dir, 'assistants.json'))
  const service = new BackupService(conversationStore, messageStore, assistantStore, { now: () => NOW })

  const seed: Fixture['seed'] = async ({ conversation, message, assistant }) => {
    await conversationStore.writeAll([
      { id: conversation, title: '会话', assistantId: null, createdAt: NOW, updatedAt: NOW }
    ])
    await messageStore.writeAll([
      {
        id: message,
        conversationId: conversation,
        role: 'user',
        content: '你好',
        status: 'complete',
        createdAt: NOW,
        updatedAt: NOW
      }
    ])
    await assistantStore.writeAll([
      {
        id: assistant,
        name: '助手',
        systemPrompt: '',
        providerId: null,
        modelId: null,
        params: { temperature: 0.7, maxTokens: 100, topP: 1 },
        createdAt: NOW,
        updatedAt: NOW
      }
    ])
  }

  const counts: Fixture['counts'] = async () => ({
    conversations: (await conversationStore.readAll()).length,
    messages: (await messageStore.readAll()).length,
    assistants: (await assistantStore.readAll()).length
  })

  try {
    await run({ service, seed, counts })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('导出包含当前全部数据', async () => {
  await withBackup(async ({ service, seed }) => {
    await seed({ conversation: 'c-1', message: 'm-1', assistant: 'a-1' })
    const doc = await service.export()

    assert.equal(doc.version, BACKUP_VERSION)
    assert.equal(doc.conversations.length, 1)
    assert.equal(doc.messages.length, 1)
    assert.equal(doc.assistants.length, 1)
  })
})

test('replace 恢复：清空后写入备份内容', async () => {
  await withBackup(async ({ service, seed, counts }) => {
    await seed({ conversation: 'c-1', message: 'm-1', assistant: 'a-1' })
    const doc = await service.export()

    const restored = await service.restore(doc, 'replace')
    assert.equal(restored.ok, true)
    assert.deepEqual(await counts(), { conversations: 1, messages: 1, assistants: 1 })
  })
})

test('merge 恢复：跳过已存在的 id，只补充新的', async () => {
  await withBackup(async ({ service, seed, counts }) => {
    await seed({ conversation: 'c-1', message: 'm-1', assistant: 'a-1' })
    const doc = createBackup(
      {
        conversations: [
          { id: 'c-1', title: '旧', assistantId: null, createdAt: NOW, updatedAt: NOW },
          { id: 'c-2', title: '新', assistantId: null, createdAt: NOW, updatedAt: NOW }
        ],
        messages: [],
        assistants: []
      },
      { now: NOW }
    )

    const restored = await service.restore(doc, 'merge')
    assert.equal(restored.ok, true)
    if (restored.ok) {
      assert.deepEqual(restored.value, { added: 1, skipped: 1 })
    }
    assert.equal((await counts()).conversations, 2)
  })
})

test('版本不匹配时不写入任何数据', async () => {
  await withBackup(async ({ service, seed, counts }) => {
    await seed({ conversation: 'c-1', message: 'm-1', assistant: 'a-1' })
    const bad = { ...createBackup({ conversations: [], messages: [], assistants: [] }, { now: NOW }), version: 9 }

    const restored = await service.restore(bad as never, 'replace')
    assert.equal(restored.ok, false)
    assert.deepEqual(await counts(), { conversations: 1, messages: 1, assistants: 1 }, '校验失败不能动现有数据')
  })
})

test('结构损坏时不写入任何数据', async () => {
  await withBackup(async ({ service, seed, counts }) => {
    await seed({ conversation: 'c-1', message: 'm-1', assistant: 'a-1' })
    const broken = { version: BACKUP_VERSION, exportedAt: NOW, conversations: [{ id: 'x' }], messages: [], assistants: [] }

    const restored = await service.restore(broken as never, 'replace')
    assert.equal(restored.ok, false)
    assert.deepEqual(await counts(), { conversations: 1, messages: 1, assistants: 1 })
  })
})
