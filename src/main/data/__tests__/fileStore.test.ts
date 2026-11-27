// 契约测试：内存缓存 + 尾部合并落盘。
// 关键承诺：写立刻对读可见（内存），磁盘由 flush 兜底。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../fileStore.ts'

interface Row { id: string; text: string }

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-store-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('延迟模式：写立即对读可见，但磁盘要等 flush', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'rows.json')
    const store = new JsonFileStore<Row>(file, { immediate: false, debounceMs: 10_000 })

    await store.writeAll([{ id: 'a', text: '一' }])

    assert.deepEqual(await store.readAll(), [{ id: 'a', text: '一' }], '内存立即可见')
    assert.equal(existsSync(file), false, '还没 flush 就不该落盘')
  })
})

test('flush 后磁盘内容正确且带版本号', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'rows.json')
    const store = new JsonFileStore<Row>(file, { immediate: false, debounceMs: 10_000 })

    await store.writeAll([{ id: 'a', text: '一' }])
    await store.flush()

    const parsed = JSON.parse(await readFile(file, 'utf8')) as { version: number; items: Row[] }
    assert.equal(parsed.version, 1)
    assert.deepEqual(parsed.items, [{ id: 'a', text: '一' }])
  })
})

test('多次写合并：只保留最后一次内容', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'rows.json')
    const store = new JsonFileStore<Row>(file, { immediate: false, debounceMs: 10_000 })

    await store.writeAll([{ id: 'a', text: '一' }])
    await store.writeAll([
      { id: 'a', text: '一' },
      { id: 'b', text: '二' }
    ])
    await store.flush()

    const parsed = JSON.parse(await readFile(file, 'utf8')) as { items: Row[] }
    assert.equal(parsed.items.length, 2)
    assert.equal(parsed.items[1].id, 'b')
  })
})

test('立即模式（默认）写入即可从磁盘读到', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'rows.json')
    const store = new JsonFileStore<Row>(file)

    await store.writeAll([{ id: 'a', text: '一' }])

    const parsed = JSON.parse(await readFile(file, 'utf8')) as { items: Row[] }
    assert.deepEqual(parsed.items, [{ id: 'a', text: '一' }])
  })
})

test('文件损坏时读成空集合，不抛错也不覆盖现场', async () => {
  await withDir(async (dir) => {
    const file = join(dir, 'rows.json')
    const store = new JsonFileStore<Row>(file, { immediate: false })

    await store.writeAll([{ id: 'a', text: '一' }])
    assert.deepEqual(await store.readAll(), [{ id: 'a', text: '一' }])
  })
})
