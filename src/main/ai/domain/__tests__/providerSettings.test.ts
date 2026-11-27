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
    { id: 'deepseek', apiKey: 'from-settings', baseUrl: 'https://a.example', model: 'm-a' },
    { apiKey: 'from-env' }
  )
  assert.deepEqual(fromSettings, {
    providerId: 'deepseek',
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
    providerId: 'deepseek',
    apiKey: 'from-env',
    baseUrl: 'https://b.example',
    model: 'm-b',
    source: 'env'
  })

  const empty = resolveProviderConfig(null, {})
  assert.equal(empty.providerId, 'deepseek')
  assert.equal(empty.apiKey, null)
  assert.equal(empty.source, 'none')
  assert.equal(empty.baseUrl, DEFAULT_BASE_URL)
  assert.equal(empty.model, DEFAULT_MODEL)
})

test('缺省平台是 deepseek，默认值与它匹配', () => {
  const result = validateSettings({ apiKey: 'k' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.providerId, 'deepseek')
    assert.equal(result.value.baseUrl, 'https://api.deepseek.com')
    assert.equal(result.value.model, 'deepseek-chat')
  }
})

test('切到 ollama 时用本地默认地址与模型，且允许空 Key', () => {
  const result = validateSettings({ providerId: 'ollama' })
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.providerId, 'ollama')
    assert.equal(result.value.baseUrl, 'http://127.0.0.1:11434')
    assert.equal(result.value.model, 'qwen2.5')
    assert.equal(result.value.apiKey, '')
  }
})

test('deepseek 仍要求 Key', () => {
  const result = validateSettings({ providerId: 'deepseek', apiKey: '   ' })
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_KEY_REQUIRED'))
  }
})

test('不支持的平台被拒绝', () => {
  const result = validateSettings({ providerId: 'openai', apiKey: 'k' } as never)
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_PROVIDER_UNSUPPORTED'))
  }
})

test('resolveProviderConfig 带出平台，且设置优先于环境变量', () => {
  const resolved = resolveProviderConfig(
    { id: 'ollama', apiKey: '', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5' },
    { apiKey: 'env-key' }
  )
  assert.equal(resolved.providerId, 'ollama')
  assert.equal(resolved.source, 'settings', '本地平台没有 Key 也应视为已配置')
  assert.equal(resolved.apiKey, '')

  const fallback = resolveProviderConfig(null, { apiKey: 'env-key' })
  assert.equal(fallback.providerId, 'deepseek')
  assert.equal(fallback.source, 'env')
})

test('采样参数可保存并带回；缺省则不出现', () => {
  const withParams = validateSettings({ apiKey: 'k', params: { temperature: 0.2, maxTokens: 512 } })
  assert.equal(withParams.ok, true)
  if (withParams.ok) {
    assert.equal(withParams.value.params?.temperature, 0.2)
    assert.equal(withParams.value.params?.maxTokens, 512)
    assert.equal(withParams.value.params?.topP, undefined)
  }

  const without = validateSettings({ apiKey: 'k' })
  assert.equal(without.ok, true)
  if (without.ok) {
    assert.equal(without.value.params, undefined, '没填就不该凭空造一份默认值')
  }
})

test('采样参数越界被拒绝', () => {
  for (const params of [
    { temperature: 3 },
    { temperature: -1 },
    { topP: 1.5 },
    { maxTokens: 0 },
    { maxTokens: 12.5 },
    { maxTokens: 999999 }
  ]) {
    const result = validateSettings({ apiKey: 'k', params })
    assert.equal(result.ok, false, JSON.stringify(params))
    if (!result.ok) {
      assert.ok(result.errors.includes('E_PARAM_RANGE'))
    }
  }
})

test('resolveProviderConfig 带出采样参数', () => {
  const resolved = resolveProviderConfig(
    { id: 'deepseek', apiKey: 'k', baseUrl: 'https://x.example', model: 'm', params: { temperature: 0.3 } },
    {}
  )
  assert.equal(resolved.params?.temperature, 0.3)
})
