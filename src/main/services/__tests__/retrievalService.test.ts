// 契约测试：工作区检索（读文件 → 切块 → 关键词检索）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { searchWorkspaceFiles } from '../retrievalService.ts'
import type { WorkspaceFile } from '../../ai/domain/workspace.ts'

const NOW = '2026-01-01T00:00:00.000Z'

function file(path: string, id = path): WorkspaceFile {
  return { id, path, sizeBytes: 10, importedAt: NOW }
}

test('命中返回来源路径与块序号，能回指原文', async () => {
  const hits = await searchWorkspaceFiles(
    '工作台',
    [file('notes/intro.md')],
    {
      readTextFile: async () => 'PointStudio 是一个 AI 工作台，负责规划与执行。'
    }
  )

  assert.equal(hits.length, 1)
  assert.equal(hits[0].chunk.source, 'notes/intro.md')
  assert.ok(hits[0].chunk.id.includes('notes/intro.md'), '块 id 应能定位到文件')
  assert.ok(hits[0].matchedTerms.length > 0)
})

test('多个文件命中的块按分数排序', async () => {
  const contents: Record<string, string> = {
    'a.md': '计划计划计划',
    'b.md': '计划出现一次而已',
    'c.md': '完全无关'
  }
  const hits = await searchWorkspaceFiles('计划', [file('a.md'), file('b.md'), file('c.md')], {
    readTextFile: async (path) => contents[path] ?? ''
  })

  assert.equal(hits.length, 2)
  assert.equal(hits[0].chunk.source, 'a.md')
  assert.equal(hits[1].chunk.source, 'b.md')
})

test('长文件被切块，检索发生在块粒度上', async () => {
  const long = '无关内容。'.repeat(50) + '这里提到了工作台。'
  const hits = await searchWorkspaceFiles('工作台', [file('long.md')], {
    readTextFile: async () => long,
    chunkChars: 30
  })

  assert.ok(hits.length >= 1)
  assert.ok(hits[0].chunk.id !== 'long.md', '应带块序号而不是只有文件名')
})

test('读取失败的文件被跳过，不影响其他文件', async () => {
  const hits = await searchWorkspaceFiles('工作台', [file('broken.md'), file('ok.md')], {
    readTextFile: async (path) => {
      if (path === 'broken.md') {
        throw new Error('E_FILE_GONE')
      }
      return '这是工作台'
    }
  })

  assert.equal(hits.length, 1)
  assert.equal(hits[0].chunk.source, 'ok.md')
})

test('空文件列表或空查询返回空结果', async () => {
  assert.deepEqual(await searchWorkspaceFiles('工作台', [], { readTextFile: async () => 'x' }), [])
  assert.deepEqual(
    await searchWorkspaceFiles('  ', [file('a.md')], { readTextFile: async () => '内容' }),
    []
  )
})

test('limit 生效，避免把整个工作区塞进上下文', async () => {
  const files = Array.from({ length: 10 }, (_, index) => file(`f${index}.md`))
  const hits = await searchWorkspaceFiles('内容', files, {
    readTextFile: async () => '内容',
    limit: 3
  })

  assert.equal(hits.length, 3)
})
