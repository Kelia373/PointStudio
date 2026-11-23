// 契约测试：模型凭据的领域规则（校验 + 脱敏 + 环境变量回退优先级）。
// 注意：这里只出现假 Key，真实凭据永不进测试、不进仓库。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  maskApiKey,
  resolveProviderConfig,
  validateSettings
} from '../providerSettings.ts'

test('合法输入被归一化（去空白、补默认值）', () => {
  const result = validateSettings({ apiKey: '  sk-test-1234  ' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.apiKey, 'sk-test-1234')
    assert.equal(result.value.baseUrl, DEFAULT_BASE_URL)
    assert.equal(result.value.model, DEFAULT_MODEL)
  }
})

test('空 Key 被拒绝，且不因为空白字符混过去', () => {
  const result = validateSettings({ apiKey: '   ' })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_KEY_REQUIRED'))
  }
})

test('非法 baseUrl 被拒绝', () => {
  for (const baseUrl of ['not-a-url', 'ftp://example.com', '']) {
    const result = validateSettings({ apiKey: 'k', baseUrl })
    assert.equal(result.ok, false, `应拒绝 ${baseUrl}`)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_BASE_URL_INVALID'))
    }
  }
})

test('baseUrl 末尾斜杠被去掉，避免拼出双斜杠', () => {
  const result = validateSettings({ apiKey: 'k', baseUrl: 'https://api.deepseek.com///' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.baseUrl, 'https://api.deepseek.com')
  }
})

test('脱敏只露头尾，短 Key 全遮', () => {
  assert.equal(maskApiKey('sk-1234567890abcdef'), 'sk-1****cdef')
  assert.equal(maskApiKey('short'), '****')
  assert.equal(maskApiKey(''), '')
})

test('配置优先级：设置 > 环境变量 > 默认', () => {
  const fromSettings = resolveProviderConfig(
    { apiKey: 'from-settings', baseUrl: 'https://a.example', model: 'm-a' },
    { apiKey: 'from-env' }
  )
  assert.deepEqual(fromSettings, {
    apiKey: 'from-settings',
    baseUrl: 'https://a.example',
    model: 'm-a',
    source: 'settings'
  })

  const fromEnv = resolveProviderConfig(null, {
    apiKey: 'from-env',
    baseUrl: 'https://b.example',
    model: 'm-b'
  })
  assert.deepEqual(fromEnv, {
    apiKey: 'from-env',
    baseUrl: 'https://b.example',
    model: 'm-b',
    source: 'env'
  })

  const empty = resolveProviderConfig(null, {})
  assert.equal(empty.apiKey, null)
  assert.equal(empty.source, 'none')
  assert.equal(empty.baseUrl, DEFAULT_BASE_URL)
  assert.equal(empty.model, DEFAULT_MODEL)
})
