// 契约测试：助手仓储 + 服务。
// 用真实文件系统（临时目录）验证，而不是打桩——持久化这种事，桩会掩盖真问题。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { AssistantService } from '../assistantService.ts'
import type { Assistant } from '../../ai/domain/assistant.ts'

async function withTempService(
  run: (ctx: { service: AssistantService; filePath: string; reopen: () => AssistantService }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-'))
  const filePath = join(dir, 'assistants.json')
  let seq = 0
  const makeService = (): AssistantService =>
    new AssistantService(new JsonFileStore<Assistant>(filePath), {
      newId: () => `id-${++seq}`,
      now: () => '2026-01-01T00:00:00.000Z'
    })
  try {
    await run({ service: makeService(), filePath, reopen: makeService })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('创建后能列出，且写入磁盘可被重新读取', async () => {
  await withTempService(async ({ service, filePath, reopen }) => {
    const created = await service.create({ name: '代码审查员' })
    assert.equal(created.ok, true)

    const listed = await service.list()
    assert.equal(listed.length, 1)
    assert.equal(listed[0].name, '代码审查员')

    // 模拟「关掉应用再打开」：新建一个 service，指向同一个文件。
    const afterRestart = await reopen().list()
    assert.equal(afterRestart.length, 1)
    assert.equal(afterRestart[0].id, listed[0].id)

    const raw = JSON.parse(await readFile(filePath, 'utf8')) as { version: number; items: unknown[] }
    assert.equal(raw.version, 1)
    assert.equal(raw.items.length, 1)
  })
})

test('非法输入返回错误码，且不落盘', async () => {
  await withTempService(async ({ service }) => {
    const result = await service.create({ name: '  ' })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_NAME_REQUIRED'))
    }
    assert.deepEqual(await service.list(), [])
  })
})

test('更新只改字段，保留 id 与 createdAt', async () => {
  await withTempService(async ({ service }) => {
    const created = await service.create({ name: '旧名' })
    assert.equal(created.ok, true)
    if (!created.ok) return

    const updated = await service.update(created.value.id, { name: '新名' })
    assert.equal(updated.ok, true)
    if (!updated.ok) return

    assert.equal(updated.value.id, created.value.id)
    assert.equal(updated.value.name, '新名')
    assert.equal(updated.value.createdAt, created.value.createdAt)
  })
})

test('更新不存在的 id 返回 E_NOT_FOUND', async () => {
  await withTempService(async ({ service }) => {
    const result = await service.update('missing', { name: '随便' })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_NOT_FOUND'))
    }
  })
})

test('删除后列表为空；删不存在的返回 E_NOT_FOUND', async () => {
  await withTempService(async ({ service }) => {
    const created = await service.create({ name: '待删' })
    assert.equal(created.ok, true)
    if (!created.ok) return

    assert.equal((await service.remove(created.value.id)).ok, true)
    assert.deepEqual(await service.list(), [])

    const again = await service.remove(created.value.id)
    assert.equal(again.ok, false)
    if (!again.ok) {
      assert.ok(again.errors.includes('E_NOT_FOUND'))
    }
  })
})

test('损坏的 JSON：返回空列表不崩，且不覆盖原文件', async () => {
  await withTempService(async ({ service, filePath }) => {
    await service.create({ name: '先写一条' })
    const { writeFile } = await import('node:fs/promises')
    const broken = '{ 这不是 json'
    await writeFile(filePath, broken, 'utf8')

    assert.deepEqual(await service.list(), [], '读不出来时返回空列表而不是崩')

    // 关键：读失败不能顺手把原文件覆盖成空集合，否则用户的数据就真没了。
    assert.equal(await readFile(filePath, 'utf8'), broken)
  })
})

test('get 能按 id 取回助手，不存在时返回 null', async () => {
  await withTempService(async ({ service }) => {
    const created = await service.create({ name: '要取的助手' })
    if (!created.ok) return

    const found = await service.get(created.value.id)
    assert.equal(found?.name, '要取的助手')
    assert.equal(await service.get('missing'), null)
  })
})
