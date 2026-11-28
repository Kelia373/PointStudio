// 契约测试：附图独立落盘、白名单校验与孤儿回收。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AttachmentService, MAX_IMAGE_BYTES } from '../attachmentService.ts'

/** 1×1 透明 PNG。 */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

let seq = 0
function uuid(): string {
  seq += 1
  return `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`
}

async function withService(
  run: (ctx: { service: AttachmentService; dir: string }) => Promise<void>
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-attach-'))
  const service = new AttachmentService(dir, { newId: uuid })
  try {
    await run({ service, dir })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('四类白名单图片可保存并读回 data URL', async () => {
  await withService(async ({ service }) => {
    for (const mime of ['image/png', 'image/jpeg', 'image/webp', 'image/gif']) {
      const dataUrl = mime === 'image/png' ? PNG : `data:${mime};base64,${Buffer.from('abc').toString('base64')}`
      const saved = await service.save({ dataUrl, name: `shot.${mime.split('/')[1]}` })
      assert.equal(saved.ok, true)
      if (!saved.ok) return
      assert.equal(saved.value.mimeType, mime)
      assert.ok(saved.value.sizeBytes > 0)

      const back = await service.readDataUrl(saved.value.id)
      assert.equal(back.ok, true)
      if (back.ok) {
        assert.ok(back.value.startsWith(`data:${mime};base64,`))
      }
    }
  })
})

test('非图片 MIME / 坏 dataUrl / 超 10MB 一律拒收', async () => {
  await withService(async ({ service }) => {
    const svg = await service.save({
      dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`
    })
    assert.equal(svg.ok, false)
    if (!svg.ok) assert.ok(svg.errors.includes('E_IMAGE_TYPE'))

    const broken = await service.save({ dataUrl: 'not-a-data-url' })
    assert.equal(broken.ok, false)

    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1, 1).toString('base64')
    const tooBig = await service.save({ dataUrl: `data:image/png;base64,${huge}` })
    assert.equal(tooBig.ok, false)
    if (!tooBig.ok) assert.ok(tooBig.errors.includes('E_IMAGE_TOO_LARGE'))
  })
})

test('非法 id 与不存在的 id：拒绝而不是抛错', async () => {
  await withService(async ({ service }) => {
    const traversal = await service.readDataUrl('../../etc/passwd')
    assert.equal(traversal.ok, false)
    if (!traversal.ok) assert.ok(traversal.errors.includes('E_BAD_INPUT'))

    const missing = await service.readDataUrl('11111111-1111-4111-8111-111111111111')
    assert.equal(missing.ok, false)
    if (!missing.ok) assert.ok(missing.errors.includes('E_NOT_FOUND'))
  })
})

test('readBase64 只给纯 base64（三线协议共用）', async () => {
  await withService(async ({ service }) => {
    const saved = await service.save({ dataUrl: PNG })
    assert.equal(saved.ok, true)
    if (!saved.ok) return
    const read = await service.readBase64(saved.value.id)
    assert.equal(read.ok, true)
    if (!read.ok) return
    assert.equal(read.value.mimeType, 'image/png')
    assert.equal(read.value.base64.startsWith('data:'), false)
  })
})

test('孤儿回收：删掉没人引用的图，保留分叉共享的图', async () => {
  await withService(async ({ service, dir }) => {
    const kept = await service.save({ dataUrl: PNG })
    const orphan = await service.save({ dataUrl: PNG })
    assert.equal(kept.ok && orphan.ok, true)
    if (!kept.ok || !orphan.ok) return

    // 分叉会话共享同一张图：只要全库还有引用就必须留着
    const removed = await service.pruneUnreferenced(new Set([kept.value.id]))
    assert.equal(removed.removed, 1)

    const left = (await readdir(dir)).sort()
    assert.equal(left.length, 1)
    assert.ok(left[0].startsWith(kept.value.id))
    assert.equal((await service.readDataUrl(orphan.value.id)).ok, false)
  })
})

test('回收时忽略非 UUID 命名的杂项文件（不误删）', async () => {
  await withService(async ({ service, dir }) => {
    await writeFile(join(dir, 'notes.txt'), 'keep me', 'utf8')
    const removed = await service.pruneUnreferenced(new Set())
    assert.equal(removed.removed, 0)
    assert.ok((await readdir(dir)).includes('notes.txt'))
  })
})
