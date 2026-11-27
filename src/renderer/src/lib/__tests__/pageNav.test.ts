// 契约测试：主舞台页面切换。
//
// 这一层修的是「点进功能页之后出不来」的死路：
// 点功能项是 toggle（再点一次回聊天），点会话永远是回聊天。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { CHAT_PAGE, nextActivePage, pageAfterSessionPick, pageTitleOf } from '../pageNav.ts'

test('聊天页是空字符串之外的哨兵值，不是某个注册页面', () => {
  assert.equal(CHAT_PAGE, 'chat')
})

test('点功能项进该页；再点同一项回聊天', () => {
  assert.equal(nextActivePage('chat', 'board'), 'board')
  assert.equal(nextActivePage('board', 'board'), 'chat')
  assert.equal(nextActivePage('board', 'prompts'), 'prompts')
})

test('从任何页面点聊天都回到聊天页', () => {
  assert.equal(nextActivePage('prompts', 'chat'), 'chat')
  assert.equal(nextActivePage('chat', 'chat'), 'chat')
})

test('点会话 / 新建会话一律回聊天：不允许卡在功能页', () => {
  assert.equal(pageAfterSessionPick(), CHAT_PAGE)
})

test('顶栏标题：功能页显示页面标题，聊天页显示会话标题', () => {
  assert.equal(pageTitleOf({ title: '提示词管理' }, '旧会话'), '提示词管理')
  assert.equal(pageTitleOf(null, '旧会话'), '旧会话')
  assert.equal(pageTitleOf(null, null), 'PointStudio')
})
