// 契约测试：崩溃报告的构造与脱敏（报告绝不能带走凭据）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  CRASH_REPORT_VERSION,
  MAX_STACK_CHARS,
  buildCrashReport,
  redactText,
  serializeCrashReport
} from '../crashReport.ts'

const NOW = '2026-01-01T00:00:00.000Z'

function build(error: Error = new Error('boom'), context: Record<string, unknown> = {}) {
  return buildCrashReport(
    { error, context },
    {
      now: NOW,
      appVersion: '0.0.0',
      platform: 'win32',
      arch: 'x64',
      electronVersion: '45.0.0'
    }
  )
}

test('报告带版本、时间、环境与错误信息', () => {
  const report = build()

  assert.equal(report.version, CRASH_REPORT_VERSION)
  assert.equal(report.generatedAt, NOW)
  assert.equal(report.platform, 'win32')
  assert.equal(report.electronVersion, '45.0.0')
  assert.equal(report.error.name, 'Error')
  assert.equal(report.error.message, 'boom')
})

test('文本里的 API Key 被抹掉', () => {
  const redacted = redactText('请求失败，key=sk-1234567890abcdef，请检查')
  assert.ok(!redacted.includes('sk-1234567890abcdef'))
  assert.ok(redacted.includes('sk-***'))
})

test('Bearer 令牌被抹掉', () => {
  const redacted = redactText('authorization: Bearer abc.def.ghi')
  assert.ok(!redacted.includes('abc.def.ghi'))
  assert.ok(redacted.includes('Bearer ***'))
})

test('错误堆栈里的凭据也会被抹（不能只处理 message）', () => {
  const error = new Error('failed with sk-abcdefgh12345678')
  error.stack = 'Error: failed with sk-abcdefgh12345678\n    at foo'
  const report = build(error)

  assert.ok(!JSON.stringify(report).includes('sk-abcdefgh12345678'))
})

test('上下文中敏感字段名被替换，其余保留', () => {
  const report = build(new Error('x'), {
    apiKey: 'sk-secret-value-123456',
    token: 'tok_123',
    password: 'p@ss',
    conversationId: 'c-1',
    nested: { secret: 'hidden', keep: 'ok' }
  })

  const text = JSON.stringify(report.context)
  assert.ok(!text.includes('sk-secret-value-123456'))
  assert.ok(!text.includes('tok_123'))
  assert.ok(!text.includes('p@ss'))
  assert.ok(!text.includes('hidden'))
  assert.ok(text.includes('c-1'), '非敏感字段要保留，否则报告没有诊断价值')
  assert.ok(text.includes('ok'))
})

test('超长堆栈被截断，避免报告失控', () => {
  const error = new Error('x')
  error.stack = 'y'.repeat(MAX_STACK_CHARS + 500)
  const report = build(error)

  assert.equal(Array.from(report.error.stack ?? '').length, MAX_STACK_CHARS)
})

test('序列化后仍是合法 JSON，且不含明文凭据', () => {
  const report = build(new Error('x'), { apiKey: 'sk-abcdefgh12345678' })
  const text = serializeCrashReport(report)

  assert.doesNotThrow(() => JSON.parse(text))
  assert.ok(!text.includes('sk-abcdefgh12345678'))
})

test('循环引用的上下文不会让报告构造崩掉', () => {
  const context: Record<string, unknown> = { id: 'c-1' }
  context.self = context

  const report = build(new Error('x'), context)
  assert.doesNotThrow(() => serializeCrashReport(report))
})
