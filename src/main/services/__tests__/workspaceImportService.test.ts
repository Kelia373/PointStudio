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
    },
    removeStored: async (relativePath) => {
      written.delete(relativePath)
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
      },
      removeStored: async () => {}
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

test('移除：登记和磁盘副本一起消失，不留孤儿文件', async () => {
  await withImport(async ({ importer, workspace, written }) => {
    const imported = await importer.importFromPath('D:/downloads/旧稿.md')
    assert.equal(imported.ok, true)
    if (!imported.ok) return
    assert.equal(written.has('旧稿.md'), true, '前提：导入后磁盘上有副本')

    const removed = await importer.remove(imported.value.id)
    assert.equal(removed.ok, true)
    assert.deepEqual(await workspace.list(), [], '列表里不能再出现这条记录')
    assert.equal(written.has('旧稿.md'), false, '磁盘副本也不能留')
  })
})

test('移除不存在的 id：报 E_NOT_FOUND，且不动磁盘副本', async () => {
  await withImport(async ({ importer, workspace, written }) => {
    const imported = await importer.importFromPath('D:/downloads/保留.md')
    assert.equal(imported.ok, true)
    if (!imported.ok) return

    const removed = await importer.remove('id-不存在')
    assert.equal(removed.ok, false)
    if (!removed.ok) {
      assert.ok(removed.errors.includes('E_NOT_FOUND'))
    }
    assert.equal((await workspace.list()).length, 1)
    assert.equal(written.has('保留.md'), true)
  })
})

test('删副本失败：登记仍然撤掉，不把移除判成失败', async () => {
  await withImport(async ({ workspace }) => {
    const stubborn = new WorkspaceImportService(workspace, {
      readSource: async () => '内容',
      writeStored: async () => {},
      removeStored: async () => {
        throw new Error('EPERM')
      }
    })

    const imported = await stubborn.importFromPath('D:/downloads/占用.md')
    assert.equal(imported.ok, true)
    if (!imported.ok) return

    const removed = await stubborn.remove(imported.value.id)
    assert.equal(removed.ok, true)
    assert.deepEqual(await workspace.list(), [], '列表以登记为准，副本残留只是浪费磁盘')
  })
})
