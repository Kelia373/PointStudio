// 契约测试：从任意路径导入文件到工作区（读源 → 落盘 → 登记）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { WorkspaceService } from '../workspaceService.ts'
import { WorkspaceImportService, toWorkspacePath } from '../workspaceImportService.ts'
import type { WorkspaceFile } from '../../ai/domain/workspace.ts'

async function withImport(
  run: (ctx: {
    importer: WorkspaceImportService
    workspace: WorkspaceService
    written: Map<string, string>
  }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-import-'))
  let seq = 0
  const workspace = new WorkspaceService(new JsonFileStore<WorkspaceFile>(join(dir, 'workspace.json')), {
    newId: () => `id-${++seq}`,
    now: () => '2026-01-01T00:00:00.000Z'
  })
  const written = new Map<string, string>()
  const importer = new WorkspaceImportService(workspace, {
    readSource: async (path) => {
      if (path.includes('missing')) {
        throw new Error('ENOENT')
      }
      if (path.includes('huge')) {
        return 'x'.repeat(6_000_000)
      }
      return `内容来自 ${path}`
    },
    writeStored: async (relativePath, content) => {
      written.set(relativePath, content)
    }
  })
  try {
    await run({ importer, workspace, written })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('导入成功：读源、落盘、登记三件事都发生', async () => {
  await withImport(async ({ importer, workspace, written }) => {
    const result = await importer.importFromPath('D:/downloads/笔记.md')

    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.value.path, '笔记.md')
    }
    assert.equal(written.get('笔记.md'), '内容来自 D:/downloads/笔记.md')
    assert.equal((await workspace.list()).length, 1)
  })
})

test('源文件读不出来：不落盘也不登记', async () => {
  await withImport(async ({ importer, workspace, written }) => {
    const result = await importer.importFromPath('D:/downloads/missing.md')

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_SOURCE_UNREADABLE'))
    }
    assert.equal(written.size, 0)
    assert.deepEqual(await workspace.list(), [])
  })
})

test('超大文件：拒绝且不落盘、不登记', async () => {
  await withImport(async ({ importer, workspace, written }) => {
    const result = await importer.importFromPath('D:/downloads/huge.md')

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_FILE_TOO_LARGE'))
    }
    assert.equal(written.size, 0)
    assert.deepEqual(await workspace.list(), [])
  })
})

test('同名文件已存在：拒绝且不覆盖已有内容', async () => {
  await withImport(async ({ importer, written }) => {
    await importer.importFromPath('D:/a/同名.md')
    const before = written.get('同名.md')

    const second = await importer.importFromPath('D:/b/同名.md')
    assert.equal(second.ok, false)
    if (!second.ok) {
      assert.ok(second.errors.includes('E_FILE_EXISTS'))
    }
    assert.equal(written.get('同名.md'), before, '不能覆盖已有文件')
  })
})

test('落盘失败：不留下登记（避免"文件在列表里但磁盘上没有"）', async () => {
  await withImport(async ({ workspace }) => {
    const failing = new WorkspaceImportService(workspace, {
      readSource: async () => '内容',
      writeStored: async () => {
        throw new Error('EIO')
      }
    })

    const result = await failing.importFromPath('D:/x/a.md')
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_WRITE_FAILED'))
    }
    assert.deepEqual(await workspace.list(), [])
  })
})

test('路径归一化：只取文件名，去掉盘符与目录', () => {
  assert.equal(toWorkspacePath('D:/downloads/笔记.md'), '笔记.md')
  assert.equal(toWorkspacePath('C:\\Users\\me\\a.txt'), 'a.txt')
  assert.equal(toWorkspacePath('/home/me/b.md'), 'b.md')
})
