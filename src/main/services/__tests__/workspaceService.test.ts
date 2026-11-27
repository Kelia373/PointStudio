// 契约测试：工作区文件导入（校验、去重、持久化、删除）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { WorkspaceService } from '../workspaceService.ts'
import type { WorkspaceFile } from '../../ai/domain/workspace.ts'
import { MAX_FILE_BYTES, validateImportRequest } from '../../ai/domain/workspace.ts'

async function withWorkspace(
  run: (ctx: { service: WorkspaceService; reopen: () => WorkspaceService }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-ws-'))
  let seq = 0
  const build = (): WorkspaceService =>
    new WorkspaceService(new JsonFileStore<WorkspaceFile>(join(dir, 'workspace.json')), {
      newId: () => `id-${++seq}`,
      now: () => `2026-01-01T00:00:0${seq}.000Z`
    })
  try {
    await run({ service: build(), reopen: build })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('导入后可按 id 取回，重启后仍在', async () => {
  await withWorkspace(async ({ service, reopen }) => {
    const imported = await service.import({ path: './docs/a.md', content: '内容' })
    assert.equal(imported.ok, true)
    if (!imported.ok) return

    assert.equal(imported.value.path, 'docs/a.md', '路径应被归一化')
    assert.equal(imported.value.sizeBytes, 6, '中文按 UTF-8 字节算，2 个汉字 = 6 字节')

    const afterRestart = await reopen().list()
    assert.equal(afterRestart.length, 1)
    assert.equal((await reopen().get(imported.value.id))?.path, 'docs/a.md')
  })
})

test('越界路径被拒绝，且不写入任何记录', async () => {
  await withWorkspace(async ({ service }) => {
    for (const path of ['../secret.txt', '/etc/passwd', 'C:\\x.txt', '']) {
      const result = await service.import({ path, content: 'x' })
      assert.equal(result.ok, false, path)
    }
    assert.deepEqual(await service.list(), [])
  })
})

test('空文件与超大文件被拒绝', async () => {
  await withWorkspace(async ({ service }) => {
    const empty = await service.import({ path: 'a.md', content: '' })
    assert.equal(empty.ok, false)
    if (!empty.ok) {
      assert.ok(empty.errors.includes('E_FILE_EMPTY'))
    }

    const huge = await service.import({ path: 'b.md', content: 'x'.repeat(MAX_FILE_BYTES + 1) })
    assert.equal(huge.ok, false)
    if (!huge.ok) {
      assert.ok(huge.errors.includes('E_FILE_TOO_LARGE'))
    }
  })
})

test('同一路径重复导入被拒绝而不是静默覆盖', async () => {
  await withWorkspace(async ({ service }) => {
    await service.import({ path: 'a.md', content: '第一次' })
    const second = await service.import({ path: 'a.md', content: '第二次' })

    assert.equal(second.ok, false)
    if (!second.ok) {
      assert.ok(second.errors.includes('E_FILE_EXISTS'))
    }
    assert.equal((await service.list())[0].sizeBytes, 9, '「第一次」三字 = 9 字节，未被第二次覆盖')
  })
})

test('删除后列表为空；删不存在的返回 E_NOT_FOUND', async () => {
  await withWorkspace(async ({ service }) => {
    const imported = await service.import({ path: 'a.md', content: 'x' })
    if (!imported.ok) return

    assert.equal((await service.remove(imported.value.id)).ok, true)
    assert.deepEqual(await service.list(), [])

    const again = await service.remove(imported.value.id)
    assert.equal(again.ok, false)
    if (!again.ok) {
      assert.ok(again.errors.includes('E_NOT_FOUND'))
    }
  })
})

test('纯校验函数：合法请求返回归一化路径与字节数', () => {
  const result = validateImportRequest({ path: './a\\b.md', content: '你好' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.path, 'a/b.md')
    assert.equal(result.value.sizeBytes, 6, '按 UTF-8 字节算，不是字符数')
  }
})
