// 契约测试：助手仓储 + 服务。
// 用真实文件系统（临时目录）验证，而不是打桩——持久化这种事，桩会掩盖真问题。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { AssistantService } from '../assistantService.ts'
import { DEFAULT_ASSISTANT_ID, type Assistant } from '../../ai/domain/assistant.ts'

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

test('创建出来默认启用；停用后重启仍是停用', async () => {
  await withTempService(async ({ service, reopen }) => {
    const created = await service.create({ name: '甲' })
    assert.equal(created.ok, true)
    if (!created.ok) {
      return
    }
    assert.equal(created.value.enabled, true)

    const updated = await service.update(created.value.id, { name: '甲', enabled: false })
    assert.equal(updated.ok, true)
    if (!updated.ok) {
      return
    }
    assert.equal(updated.value.enabled, false)

    // 落盘之后重新打开：停用不是内存里的标记
    const afterRestart = await reopen().list()
    assert.equal(afterRestart[0].enabled, false)
  })
})

test('重新启用时身份字段不变', async () => {
  await withTempService(async ({ service }) => {
    const created = await service.create({ name: '乙', enabled: false })
    assert.equal(created.ok, true)
    if (!created.ok) {
      return
    }

    const back = await service.update(created.value.id, { name: '乙', enabled: true })
    assert.equal(back.ok, true)
    if (!back.ok) {
      return
    }
    assert.equal(back.value.enabled, true)
    assert.equal(back.value.id, created.value.id)
    assert.equal(back.value.createdAt, created.value.createdAt)
  })
})

test('更新时没传 enabled：停用状态不会被悄悄清掉', async () => {
  await withTempService(async ({ service }) => {
    const created = await service.create({ name: '丙', enabled: false })
    assert.equal(created.ok, true)
    if (!created.ok) {
      return
    }

    // 只有名字和提示词的编辑表单保存一次，也应该保住停用状态
    const renamed = await service.update(created.value.id, { name: '丙改' })
    assert.equal(renamed.ok, true)
    if (!renamed.ok) {
      return
    }
    assert.equal(renamed.value.name, '丙改')
    assert.equal(renamed.value.enabled, false)
  })
})

test('新助手默认 smart 权限与自动头像（null）', async () => {
  await withTempService(async ({ service }) => {
    const created = await service.create({ name: '默认权限' })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.equal(created.value.permissionMode, 'smart')
    assert.equal(created.value.avatar, null)
  })
})

test('创建时写入权限模式与头像，重新打开仍在', async () => {
  await withTempService(async ({ service, reopen }) => {
    const created = await service.create({
      name: '只读助手',
      permissionMode: 'plan-only',
      avatar: 'telescope'
    })
    assert.equal(created.ok, true)
    if (!created.ok) return
    assert.equal(created.value.permissionMode, 'plan-only')
    assert.equal(created.value.avatar, 'telescope')

    const afterRestart = await reopen().list()
    assert.equal(afterRestart[0].permissionMode, 'plan-only')
    assert.equal(afterRestart[0].avatar, 'telescope')
  })
})

test('只改名时权限模式与头像不被洗掉', async () => {
  await withTempService(async ({ service }) => {
    const created = await service.create({
      name: '甲',
      permissionMode: 'full-access',
      avatar: 'rocket'
    })
    assert.equal(created.ok, true)
    if (!created.ok) return

    const renamed = await service.update(created.value.id, { name: '甲改' })
    assert.equal(renamed.ok, true)
    if (!renamed.ok) return
    assert.equal(renamed.value.permissionMode, 'full-access')
    assert.equal(renamed.value.avatar, 'rocket')
  })
})

test('非法权限模式返回 E_PERMISSION_MODE_INVALID 且不落盘', async () => {
  await withTempService(async ({ service }) => {
    const result = await service.create({
      name: '坏权限',
      permissionMode: 'root' as never
    })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_PERMISSION_MODE_INVALID'))
    }
    assert.deepEqual(await service.list(), [])
  })
})

test('内置通用助手：幂等创建，且不覆盖用户改过的配置', async () => {
  await withTempService(async ({ service, reopen }) => {
    const first = await service.ensureBuiltin()
    assert.equal(first.id, DEFAULT_ASSISTANT_ID)
    assert.equal(first.builtin, true)
    assert.equal(first.systemPrompt, '')
    assert.equal(first.enabled, true)
    assert.equal(first.permissionMode, 'smart')

    // 用户改名 + 换模型
    const updated = await service.update(DEFAULT_ASSISTANT_ID, {
      name: '我的通用助手',
      modelId: 'deepseek-chat',
      providerId: 'deepseek'
    })
    assert.equal(updated.ok, true)
    if (!updated.ok) return
    assert.equal(updated.value.builtin, true, '内置标记不能被一次整条替换洗掉')

    // 再启动一次：不新建、不洗回默认值
    const again = await reopen().ensureBuiltin()
    assert.equal(again.name, '我的通用助手')
    assert.equal(again.modelId, 'deepseek-chat')
    assert.equal((await reopen().list()).filter((item) => item.builtin === true).length, 1)
  })
})

test('内置通用助手：不可停用、不可删除', async () => {
  await withTempService(async ({ service }) => {
    await service.ensureBuiltin()

    const disabled = await service.update(DEFAULT_ASSISTANT_ID, {
      name: '通用助手',
      enabled: false
    })
    assert.equal(disabled.ok, false)
    if (!disabled.ok) {
      assert.ok(disabled.errors.includes('E_BUILTIN_PROTECTED'))
    }

    const removed = await service.remove(DEFAULT_ASSISTANT_ID)
    assert.equal(removed.ok, false)
    if (!removed.ok) {
      assert.ok(removed.errors.includes('E_BUILTIN_PROTECTED'))
    }
    assert.equal((await service.list()).length, 1, '内置助手必须还在')
  })
})

test('内置通用助手恒排第一，其余保持存储顺序', async () => {
  await withTempService(async ({ service }) => {
    await service.create({ name: 'A' })
    await service.ensureBuiltin()
    await service.create({ name: 'B' })

    const names = (await service.list()).map((item) => item.name)
    assert.equal(names[0], '通用助手')
  })
})
