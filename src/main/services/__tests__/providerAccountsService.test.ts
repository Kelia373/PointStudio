// 契约测试：多服务商凭据库（互不覆盖、Key 沿用、旧数据迁移、脱敏）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { ProviderAccountsService } from '../providerAccountsService.ts'
import type { ProviderAccount } from '../../ai/domain/providerAccounts.ts'
import type { ProviderSettings } from '../../ai/domain/providerSettings.ts'

async function withService(
  run: (ctx: {
    service: ProviderAccountsService
    filePath: string
    reopen: () => ProviderAccountsService
  }) => Promise<void>,
  legacy?: () => Promise<ProviderSettings | null>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-accounts-'))
  const filePath = join(dir, 'provider-accounts.json')
  const build = (): ProviderAccountsService =>
    new ProviderAccountsService(new JsonFileStore<ProviderAccount>(filePath), {
      now: () => '2026-01-01T00:00:00.000Z',
      ...(legacy ? { legacy: { read: legacy } } : {})
    })
  try {
    await run({ service: build(), filePath, reopen: build })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('三家独立保存：互不覆盖，重启后都在', async () => {
  await withService(async ({ service, reopen }) => {
    await service.save({
      providerId: 'deepseek',
      protocol: 'deepseek',
      apiKey: 'sk-ds-test',
      baseUrl: 'https://api.deepseek.com'
    })
    await service.save({
      providerId: 'opencode-go',
      protocol: 'opencode-go',
      apiKey: 'oc_sk_test',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1'
    })
    await service.save({
      providerId: 'ollama',
      protocol: 'ollama',
      baseUrl: 'http://127.0.0.1:11434'
    })

    const reopened = await reopen().listMasked()
    assert.deepEqual(
      reopened.map((item) => item.providerId).sort(),
      ['deepseek', 'ollama', 'opencode-go']
    )
    assert.equal(reopened.find((item) => item.providerId === 'deepseek')?.maskedKey, 'sk-d****test')
    assert.equal(reopened.find((item) => item.providerId === 'ollama')?.hasKey, false)
  })
})

test('保存 Ollama 不动 DeepSeek 的 Key（旧 P2 的回归）', async () => {
  await withService(async ({ service }) => {
    await service.save({
      providerId: 'deepseek',
      protocol: 'deepseek',
      apiKey: 'sk-keep-me',
      baseUrl: 'https://api.deepseek.com'
    })
    await service.save({
      providerId: 'ollama',
      protocol: 'ollama',
      baseUrl: 'http://127.0.0.1:11434'
    })
    assert.equal((await service.getInternal('deepseek'))?.apiKey, 'sk-keep-me')
  })
})

test('只改模型 / 地址时留空 apiKey，原 Key 保留', async () => {
  await withService(async ({ service }) => {
    await service.save({
      providerId: 'opencode-go',
      protocol: 'opencode-go',
      apiKey: 'oc_sk_test',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1'
    })
    const updated = await service.save({
      providerId: 'opencode-go',
      protocol: 'opencode-go',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1',
      defaultModel: 'glm-4.5'
    })
    assert.equal(updated.ok, true)
    const account = await service.getInternal('opencode-go')
    assert.equal(account?.apiKey, 'oc_sk_test')
    assert.equal(account?.defaultModel, 'glm-4.5')
  })
})

test('非法草稿不落盘', async () => {
  await withService(async ({ service }) => {
    const result = await service.save({ providerId: 'deepseek', baseUrl: 'https://x/v1' })
    assert.equal(result.ok, false)
    assert.deepEqual(await service.list(), [])
  })
})

test('删除一家不影响其他家', async () => {
  await withService(async ({ service }) => {
    await service.save({ providerId: 'deepseek', protocol: 'deepseek', apiKey: 'sk-a', baseUrl: 'https://api.deepseek.com' })
    await service.save({ providerId: 'ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434' })
    await service.clear('ollama')
    const remaining = await service.listMasked()
    assert.deepEqual(remaining.map((item) => item.providerId), ['deepseek'])
  })
})

test('首次启动把旧单行 provider.json 迁进来，之后不再重复迁移', async () => {
  let legacyReads = 0
  await withService(
    async ({ service }) => {
      const first = await service.list()
      assert.equal(first.length, 1)
      assert.equal(first[0].id, 'deepseek')
      assert.equal(first[0].apiKey, 'sk-legacy')
      await service.list()
      assert.equal(legacyReads, 1, '只迁移一次')
    },
    async () => {
      legacyReads += 1
      return {
        id: 'deepseek',
        apiKey: 'sk-legacy',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-chat',
        updatedAt: '2025-12-31T00:00:00.000Z'
      }
    }
  )
})

test('落盘是明文供运行时使用，但对外列表不含明文', async () => {
  await withService(async ({ service, filePath }) => {
    await service.save({
      providerId: 'deepseek',
      protocol: 'deepseek',
      apiKey: 'sk-very-secret',
      baseUrl: 'https://api.deepseek.com'
    })
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { items: ProviderAccount[] }
    assert.equal(raw.items[0].apiKey, 'sk-very-secret')

    const masked = await service.listMasked()
    assert.equal(JSON.stringify(masked).includes('sk-very-secret'), false)
  })
})

test('listReadyProviderIds：本地免 Key 算配通，API 需有 Key', async () => {
  await withService(async ({ service }) => {
    await service.save({ providerId: 'ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434' })
    await service.save({
      providerId: 'deepseek',
      protocol: 'deepseek',
      apiKey: 'sk-ready',
      baseUrl: 'https://api.deepseek.com'
    })
    assert.deepEqual((await service.listReadyProviderIds()).sort(), ['deepseek', 'ollama'])
    await service.clear('deepseek')
    assert.deepEqual(await service.listReadyProviderIds(), ['ollama'])
  })
})
