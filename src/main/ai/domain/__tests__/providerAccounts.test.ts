// 契约测试：多服务商凭据的领域规则（合法性、Key 沿用、脱敏）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isProviderAccountId,
  toAccountView,
  validateAccountDraft,
  type ProviderAccount
} from '../providerAccounts.ts'

test('合法草稿：默认协议与默认模型按已知平台补齐', () => {
  const checked = validateAccountDraft({
    providerId: 'opencode-go',
    baseUrl: 'https://opencode.ai/inference/go/openai/v1',
    apiKey: 'oc_sk_test'
  })
  assert.equal(checked.ok, true)
  if (!checked.ok) return
  assert.equal(checked.value.protocol, 'opencode-go')
  assert.equal(checked.value.defaultModel, 'kimi-k2.5')
})

test('providerId 只认小写 slug；非法 id 直接拒绝', () => {
  assert.equal(isProviderAccountId('opencode-go'), true)
  assert.equal(isProviderAccountId('my_gateway-2'), true)
  assert.equal(isProviderAccountId('Bad Id'), false)
  assert.equal(isProviderAccountId(''), false)
  assert.equal(isProviderAccountId(42), false)

  const bad = validateAccountDraft({ providerId: 'Bad Id', baseUrl: 'https://x/v1' })
  assert.equal(bad.ok, false)
})

test('非本地协议必须有 Key；本地协议不需要', () => {
  const missing = validateAccountDraft({ providerId: 'deepseek', baseUrl: 'https://api.deepseek.com' })
  assert.equal(missing.ok, false)

  const local = validateAccountDraft({
    providerId: 'ollama',
    baseUrl: 'http://127.0.0.1:11434'
  })
  assert.equal(local.ok, true)
  if (local.ok) {
    assert.equal(local.value.apiKey, '')
    assert.equal(local.value.protocol, 'ollama')
  }
})

test('留空 Key 时沿用已保存的 Key；显式新 Key 覆盖', () => {
  const kept = validateAccountDraft(
    { providerId: 'deepseek', baseUrl: 'https://proxy/v1', apiKey: '' },
    'sk-existing'
  )
  assert.equal(kept.ok, true)
  if (kept.ok) {
    assert.equal(kept.value.apiKey, 'sk-existing')
  }

  const replaced = validateAccountDraft(
    { providerId: 'deepseek', baseUrl: 'https://proxy/v1', apiKey: 'sk-new' },
    'sk-existing'
  )
  assert.equal(replaced.ok, true)
  if (replaced.ok) {
    assert.equal(replaced.value.apiKey, 'sk-new')
  }
})

test('Base URL 必须是 http(s)，参数越界报 E_PARAM_RANGE', () => {
  const badUrl = validateAccountDraft({
    providerId: 'deepseek',
    baseUrl: 'ftp://api.deepseek.com',
    apiKey: 'k'
  })
  assert.equal(badUrl.ok, false)
  if (!badUrl.ok) {
    assert.ok(badUrl.errors.includes('E_BASE_URL_INVALID'))
  }

  const badParams = validateAccountDraft({
    providerId: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    apiKey: 'k',
    params: { temperature: 3 }
  })
  assert.equal(badParams.ok, false)
  if (!badParams.ok) {
    assert.ok(badParams.errors.includes('E_PARAM_RANGE'))
  }
})

test('对外视图只给脱敏 Key', () => {
  const account: ProviderAccount = {
    id: 'deepseek',
    protocol: 'deepseek',
    apiKey: 'sk-test-abcd1234',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
  const view = toAccountView(account)
  assert.equal(view.hasKey, true)
  assert.equal(view.maskedKey, 'sk-t****1234')
  assert.equal(JSON.stringify(view).includes('sk-test-abcd1234'), false)
})
