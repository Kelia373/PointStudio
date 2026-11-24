// 契约测试：会话搜索过滤。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { filterConversations } from '../filterConversations.ts'
import type { ConversationDto } from '../../../../shared/types/ipc.ts'

function conversation(title: string, id = title): ConversationDto {
  return { id, title, assistantId: null, createdAt: '', updatedAt: '' }
}

const LIST = [conversation('动效素材的授权清单'), conversation('状态设计的层级问题'), conversation('Import Log 排查')]

test('空关键字返回原列表（不是空数组）', () => {
  assert.equal(filterConversations(LIST, '').length, 3)
  assert.equal(filterConversations(LIST, '   ').length, 3)
})

test('按标题片段过滤，大小写不敏感', () => {
  assert.deepEqual(
    filterConversations(LIST, '层级').map((item) => item.id),
    ['状态设计的层级问题']
  )
  assert.deepEqual(
    filterConversations(LIST, 'import').map((item) => item.id),
    ['Import Log 排查']
  )
})

test('关键字两端空格被忽略', () => {
  assert.equal(filterConversations(LIST, '  素材  ').length, 1)
})

test('没有命中时返回空数组（界面据此显示「没有匹配」）', () => {
  assert.deepEqual(filterConversations(LIST, '不存在的词'), [])
})

test('不改变原列表顺序', () => {
  const result = filterConversations(LIST, '问题')
  assert.equal(result.length, 1)
  assert.equal(result[0].title, '状态设计的层级问题')
})
