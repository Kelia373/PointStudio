// 契约测试：错误码 → 人话文案。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ERROR_MESSAGES, describeError } from '../errors.ts'

test('已知错误码翻译成人话，且不再包含错误码本身', () => {
  const text = describeError('E_UPSTREAM')
  assert.ok(text.length > 0)
  assert.equal(text.includes('E_UPSTREAM'), false, '文案里不该再出现错误码')
})

test('未知错误码回退到通用文案，不把码直接甩给用户', () => {
  const text = describeError('E_SOMETHING_NEW')
  assert.ok(text.length > 0)
  assert.equal(text.includes('E_SOMETHING_NEW'), false)
})

test('空码也是通用文案，不抛异常', () => {
  assert.ok(describeError('').length > 0)
})

test('所有已声明过的错误码都有对应文案（防止新增码漏配）', () => {
  // 这些码分布在 provider / tool / settings / conversation / turn / backup / mcp
  const declared = [
    'E_BAD_INPUT',
    'E_INTERNAL',
    'E_NOT_FOUND',
    'E_UPSTREAM',
    'E_MISSING_KEY',
    'E_HTTP',
    'E_STREAM',
    'E_ABORTED',
    'E_TOOL_NOT_FOUND',
    'E_TOOL_BAD_ARGS',
    'E_TOOL_FAILED',
    'E_TOOL_TIMEOUT',
    'E_NAME_REQUIRED',
    'E_NAME_TOO_LONG',
    'E_PARAM_RANGE',
    'E_TITLE_REQUIRED',
    'E_TITLE_TOO_LONG',
    'E_EMPTY_CONTENT',
    'E_BAD_ROLE',
    'E_KEY_REQUIRED',
    'E_BASE_URL_INVALID',
    'E_PROVIDER_UNSUPPORTED',
    'E_PATH_UNSAFE',
    'E_FILE_EMPTY',
    'E_FILE_TOO_LARGE',
    'E_FILE_EXISTS',
    'E_SOURCE_UNREADABLE',
    'E_WRITE_FAILED',
    'E_BACKUP_NOT_JSON',
    'E_BACKUP_SHAPE',
    'E_BACKUP_VERSION',
    'E_CRASH_LOG_WRITE_FAILED',
    'E_STEP_NEEDS_CONFIRMATION',
    'E_PLAN_JSON_INVALID',
    'E_STEP_NOT_FOUND',
    'E_CANCELLED'
  ]

  const missing = declared.filter((code) => !(code in ERROR_MESSAGES))
  assert.deepEqual(missing, [], `以下错误码没有文案：${missing.join(', ')}`)
})

test('每条文案都是非空且不重复的（重复即说明没想清楚）', () => {
  const values = Object.values(ERROR_MESSAGES)
  assert.ok(values.every((text) => text.trim().length > 0))
  assert.equal(new Set(values).size, values.length, '存在重复文案')
})
