// 契约测试：凭据的持久化（保存/读取/清除/重启后仍在/对外脱敏）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { ProviderSettingsService } from '../providerSettingsService.ts'
import type { ProviderSettings } from '../../ai/domain/providerSettings.ts'

async function withService(
  run: (ctx: { service: ProviderSettingsService; filePath: string; reopen: () => ProviderSettingsService }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-settings-'))
  const filePath = join(dir, 'provider.json')
  const build = (): ProviderSettingsService =>
    new ProviderSettingsService(new JsonFileStore<ProviderSettings>(filePath), {
      now: () => '2026-01-01T00:00:00.000Z'
    })
  try {
    await run({ service: build(), filePath, reopen: build })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('保存后能读回，且重启后还在', async () => {
  await withService(async ({ service, reopen }) => {
    const saved = await service.save({ apiKey: 'sk-test-abcd1234', model: 'deepseek-chat' })
    assert.equal(saved.ok, true)

    const read = await service.read()
    assert.equal(read?.apiKey, 'sk-test-abcd1234')
    assert.equal(read?.model, 'deepseek-chat')
    assert.equal(read?.updatedAt, '2026-01-01T00:00:00.000Z')

    assert.equal((await reopen().read())?.apiKey, 'sk-test-abcd1234')
  })
})

test('文件里存的是明文，但对外接口只给脱敏值', async () => {
  await withService(async ({ service, filePath }) => {
    await service.save({ apiKey: 'sk-test-abcd1234' })

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { items: ProviderSettings[] }
    assert.equal(raw.items[0].apiKey, 'sk-test-abcd1234', '落盘是明文，供运行时调用')

    const view = await service.readMasked()
    assert.equal(view.hasKey, true)
    assert.equal(view.maskedKey, 'sk-t****1234')
    assert.ok(!JSON.stringify(view).includes('sk-test-abcd1234'), '对外视图不得包含明文 Key')
  })
})

test('未配置时读取为 null，脱敏视图 hasKey=false', async () => {
  await withService(async ({ service }) => {
    assert.equal(await service.read(), null)
    const view = await service.readMasked()
    assert.equal(view.hasKey, false)
    assert.equal(view.maskedKey, '')
  })
})

test('非法输入不落盘', async () => {
  await withService(async ({ service }) => {
    const result = await service.save({ apiKey: '' })
    assert.equal(result.ok, false)
    assert.equal(await service.read(), null)
  })
})

test('清除凭据后读取为 null', async () => {
  await withService(async ({ service }) => {
    await service.save({ apiKey: 'sk-x' })
    const cleared = await service.clear()
    assert.equal(cleared.ok, true)
    assert.equal(await service.read(), null)
  })
})

test('再次保存会覆盖旧值而不是追加', async () => {
  await withService(async ({ service, filePath }) => {
    await service.save({ apiKey: 'sk-old' })
    await service.save({ apiKey: 'sk-new' })

    assert.equal((await service.read())?.apiKey, 'sk-new')
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { items: unknown[] }
    assert.equal(raw.items.length, 1)
  })
})

test('只改模型时保留已保存的 Key', async () => {
  await withService(async ({ service }) => {
    await service.save({ apiKey: 'sk-keep-me' })
    const updated = await service.save({ apiKey: '', model: 'deepseek-reasoner' })

    assert.equal(updated.ok, true)
    const current = await service.read()
    assert.equal(current?.apiKey, 'sk-keep-me')
    assert.equal(current?.model, 'deepseek-reasoner')
  })
})

test('可以切换到 ollama 并保留空 Key', async () => {
  await withService(async ({ service }) => {
    const saved = await service.save({ providerId: 'ollama' })
    assert.equal(saved.ok, true)

    const view = await service.readMasked()
    assert.equal(view.providerId, 'ollama')
    assert.equal(view.hasKey, false)
    assert.equal(view.baseUrl, 'http://127.0.0.1:11434')
  })
})
