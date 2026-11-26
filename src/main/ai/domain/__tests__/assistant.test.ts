// 契约测试：助手（角色）的领域校验与构造。
// 这一层是纯逻辑，不碰文件、不碰 Electron，所以可以脱离运行环境单测。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_PARAMS,
  buildAssistant,
  validateAssistantDraft
} from '../assistant.ts'

test('名称去首尾空白后入库', () => {
  const result = validateAssistantDraft({ name: '  代码审查员  ' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.name, '代码审查员')
  }
})

test('空名称被拒绝', () => {
  const result = validateAssistantDraft({ name: '   ' })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_NAME_REQUIRED'))
  }
})

test('名称过长被拒绝', () => {
  const result = validateAssistantDraft({ name: '名'.repeat(61) })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_NAME_TOO_LONG'))
  }
})

test('未给参数时套用默认值', () => {
  const result = validateAssistantDraft({ name: '默认参数' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.deepEqual(result.value.params, DEFAULT_PARAMS)
  }
})

test('参数越界被拒绝（temperature / topP / maxTokens）', () => {
  const cases = [
    { temperature: 3 },
    { temperature: -0.1 },
    { topP: 1.5 },
    { topP: -1 },
    { maxTokens: 0 },
    { maxTokens: 999999 },
    { maxTokens: 12.5 }
  ]
  for (const params of cases) {
    const result = validateAssistantDraft({ name: '边界', params })
    assert.equal(result.ok, false, `应拒绝 ${JSON.stringify(params)}`)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_PARAM_RANGE'))
    }
  }
})

test('构建助手时注入 id 与时间戳，且不共享默认对象引用', () => {
  const first = buildAssistant(
    { name: '甲', systemPrompt: '你是甲' },
    { id: 'id-1', now: '2026-01-01T00:00:00.000Z' }
  )
  const second = buildAssistant({ name: '乙' }, { id: 'id-2', now: first.createdAt })

  assert.equal(first.id, 'id-1')
  assert.equal(first.name, '甲')
  assert.equal(first.createdAt, '2026-01-01T00:00:00.000Z')
  assert.notEqual(first.params, second.params, '默认参数不能共用同一个对象')
})

test('构建前必须先通过校验（非法输入直接抛错）', () => {
  assert.throws(() =>
    buildAssistant({ name: '' }, { id: 'x', now: '2026-01-01T00:00:00.000Z' })
  )
})

test('默认启用：草稿里没写 enabled 就按启用处理', () => {
  const result = validateAssistantDraft({ name: '默认启用' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.enabled, true)
  }
})

test('显式停用会被保留，不会被每次更新重置回启用', () => {
  const result = validateAssistantDraft({ name: '停用的', enabled: false })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.enabled, false)
  }
})

test('enabled 只认布尔值', () => {
  const result = validateAssistantDraft({ name: '类型不对', enabled: 'no' as unknown as boolean })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_ENABLED_INVALID'))
  }
})

test('构建实体带上 enabled：缺省启用，显式停用保留', () => {
  const enabled = buildAssistant({ name: '甲' }, { id: 'id-1', now: '2026-01-01T00:00:00.000Z' })
  const disabled = buildAssistant(
    { name: '乙', enabled: false },
    { id: 'id-2', now: '2026-01-01T00:00:00.000Z' }
  )
  assert.equal(enabled.enabled, true)
  assert.equal(disabled.enabled, false)
})
