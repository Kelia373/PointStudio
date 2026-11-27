// 契约测试：字节数格式化（界面显示文件大小时用）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { formatBytes } from '../../../shared/utils/format.ts'

test('小于 1 KB 显示字节', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1023), '1023 B')
})

test('KB / MB 保留一位小数', () => {
  assert.equal(formatBytes(1024), '1.0 KB')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(1024 * 1024), '1.0 MB')
  assert.equal(formatBytes(5 * 1024 * 1024), '5.0 MB')
})

test('非法或负数输入按 0 处理，不显示 NaN', () => {
  assert.equal(formatBytes(-1), '0 B')
  assert.equal(formatBytes(Number.NaN), '0 B')
})
