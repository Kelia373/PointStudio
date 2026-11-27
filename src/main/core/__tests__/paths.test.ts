// 契约测试：数据文件路径注册表。
//
// 这些文件名是「事实上的数据契约」：写错一个字母不会报错，
// 只会让用户的历史看起来凭空消失。所以必须有测试锁住。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import { buildDataPaths } from '../paths.ts'

const DATA_DIR = join('C:', 'Users', 'test', 'AppData', 'Roaming', 'PointStudio')

test('所有文件都落在数据目录下', () => {
  const paths = buildDataPaths(DATA_DIR)
  for (const value of Object.values(paths)) {
    assert.ok(value.startsWith(DATA_DIR), `${value} 不在数据目录下`)
  }
})

test('集合文件名稳定（改名即等于丢数据）', () => {
  const paths = buildDataPaths(DATA_DIR)
  assert.equal(paths.conversations, join(DATA_DIR, 'conversations.json'))
  assert.equal(paths.messages, join(DATA_DIR, 'messages.json'))
  assert.equal(paths.assistants, join(DATA_DIR, 'assistants.json'))
  assert.equal(paths.providerSettings, join(DATA_DIR, 'provider.json'))
  assert.equal(paths.workspaceIndex, join(DATA_DIR, 'workspace.json'))
})

test('目录类路径与文件路径不同', () => {
  const paths = buildDataPaths(DATA_DIR)
  assert.equal(paths.workspaceRoot, join(DATA_DIR, 'workspace'))
  assert.equal(paths.crashDir, join(DATA_DIR, 'crash'))
})

test('没有任何两个路径相同（防复制粘贴写重）', () => {
  const paths = buildDataPaths(DATA_DIR)
  const values = Object.values(paths)
  assert.equal(new Set(values).size, values.length, '存在重复路径')
})

test('传入带尾斜杠的目录也能得到一致结果', () => {
  const withSlash = buildDataPaths(`${DATA_DIR}/`)
  const without = buildDataPaths(DATA_DIR)
  assert.equal(withSlash.conversations, without.conversations)
})
