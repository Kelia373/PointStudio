// 契约测试：会话与消息的领域规则（纯逻辑，零 IO）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CONVERSATION_TITLE,
  TITLE_MAX_LENGTH,
  deriveTitle,
  validateTitle
} from '../conversation.ts'

test('标题从首条消息派生：折叠空白', () => {
  assert.equal(deriveTitle('  帮我   看看\n这个报错  '), '帮我 看看 这个报错')
})

test('标题过长时按码点截断，不切坏 emoji', () => {
  const text = '😀'.repeat(TITLE_MAX_LENGTH + 5)
  const title = deriveTitle(text)
  assert.equal(Array.from(title).length, TITLE_MAX_LENGTH)
  assert.ok(!title.includes('\uFFFD'))
})

test('空消息文本回落到默认标题', () => {
  assert.equal(deriveTitle('   '), DEFAULT_CONVERSATION_TITLE)
})

test('校验标题：空与超长各给错误码', () => {
  const empty = validateTitle('   ')
  assert.equal(empty.ok, false)
  if (!empty.ok) {
    assert.ok(empty.errors.includes('E_TITLE_REQUIRED'))
  }

  const tooLong = validateTitle('字'.repeat(TITLE_MAX_LENGTH + 1))
  assert.equal(tooLong.ok, false)
  if (!tooLong.ok) {
    assert.ok(tooLong.errors.includes('E_TITLE_TOO_LONG'))
  }
})

test('校验标题：合法输入去空白后返回', () => {
  const result = validateTitle('  新会话  ')
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value, '新会话')
  }
})
