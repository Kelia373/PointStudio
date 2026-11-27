// 契约测试：路径安全与归一化。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isSafeRelativePath, normalizeRelativePath } from '../paths.ts'

test('接受工作区内的相对路径', () => {
  for (const path of ['a.md', 'docs/b.md', 'a/b/c.txt', './notes/x.md']) {
    assert.equal(isSafeRelativePath(path), true, path)
  }
})

test('拒绝绝对路径、盘符路径、穿越与空路径', () => {
  for (const path of ['/etc/passwd', '\\windows\\x', 'C:\\x', '../x', 'a/../../b', '']) {
    assert.equal(isSafeRelativePath(path), false, path)
  }
})

test('归一化统一分隔符并去掉开头的 ./', () => {
  assert.equal(normalizeRelativePath('./a\\b\\c.md'), 'a/b/c.md')
  assert.equal(normalizeRelativePath('  docs//x.md '), 'docs/x.md')
})
