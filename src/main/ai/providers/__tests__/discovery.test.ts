// 契约测试：真实模型列表与官方用量的拉取与归一（fetch 注入，不连外网）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  fetchProviderModels,
  fetchProviderUsage,
  normalizeOpencodeModel
} from '../discovery.ts'
import type { ProviderAccount } from '../../domain/providerAccounts.ts'

function account(overrides: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: 'deepseek',
    protocol: 'deepseek',
    apiKey: 'test-key-ds',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

function jsonFetch(payload: unknown, check?: (url: string, init?: RequestInit) => void): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    check?.(String(input), init)
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
  }) as typeof fetch
}

test('DeepSeek：GET /models，带 Bearer，映射 data[].id', async () => {
  let url = ''
  let auth = ''
  const result = await fetchProviderModels(
    account({}),
    jsonFetch({ data: [{ id: 'deepseek-chat' }, { id: 'deepseek-reasoner' }] }, (target, init) => {
      url = target
      auth = (init?.headers as Record<string, string>)['authorization'] ?? ''
    }),
    { now: (() => {
      let tick = 0
      return () => 1_000 + tick++
    })() }
  )
  assert.equal(url, 'https://api.deepseek.com/models')
  assert.equal(auth, 'Bearer test-key-ds')
  assert.deepEqual(result.models.map((item) => item.id), ['deepseek-chat', 'deepseek-reasoner'])
  assert.equal(result.latencyMs, 1)
})

test('OpenCode Go：从 /zen/go 自定义 origin 推导 /models，去前缀并标记 -free', async () => {
  let url = ''
  const result = await fetchProviderModels(
    account({
      id: 'opencode-go',
      protocol: 'opencode-go',
      baseUrl: 'https://opencode.ai/zen/go/openai/v1'
    }),
    jsonFetch(
      {
        data: [
          { id: 'opencode-go/kimi-k2.5' },
          { id: 'opencode-go/claude-sonnet-4-5' },
          { id: 'opencode-go/glm-4.5-free' }
        ]
      },
      (target) => {
        url = target
      }
    )
  )
  assert.equal(url, 'https://opencode.ai/zen/go/v1/models')
  assert.deepEqual(
    result.models.map((item) => [item.id, item.wire, item.selectable]),
    [
      ['kimi-k2.5', 'openai', true],
      ['claude-sonnet-4-5', 'anthropic', true],
      ['glm-4.5-free', 'openai', false]
    ]
  )
  assert.equal(result.models[2].note, '仅官方 OpenCode 客户端可用')
  assert.equal(normalizeOpencodeModel('opencode-go/x').id, 'x')
})

test('Ollama：走 /api/tags，取 models[].name', async () => {
  let url = ''
  const result = await fetchProviderModels(
    account({ id: 'ollama', protocol: 'ollama', apiKey: '', baseUrl: 'http://127.0.0.1:11434' }),
    jsonFetch({ models: [{ name: 'qwen2.5' }, { name: 'llama3.1' }] }, (target) => {
      url = target
    })
  )
  assert.equal(url, 'http://127.0.0.1:11434/api/tags')
  assert.deepEqual(result.models.map((item) => item.id), ['qwen2.5', 'llama3.1'])
})

test('DeepSeek 余额：解析 balance_infos 与可用状态', async () => {
  const usage = await fetchProviderUsage(
    account({}),
    jsonFetch({
      is_available: true,
      balance_infos: [
        {
          currency: 'CNY',
          total_balance: '12.34',
          granted_balance: '2.00',
          topped_up_balance: '10.34'
        }
      ]
    }),
    '2026-02-01T00:00:00.000Z'
  )
  assert.equal(usage.kind, 'balance')
  assert.equal(usage.available, true)
  assert.equal(usage.balances?.[0].totalBalance, '12.34')
  assert.equal(usage.balances?.[0].grantedBalance, '2.00')
  assert.equal(usage.fetchedAt, '2026-02-01T00:00:00.000Z')
})

test('OpenCode Go 配额：rolling / weekly / monthly 三窗与重置时间', async () => {
  let url = ''
  const usage = await fetchProviderUsage(
    account({
      id: 'opencode-go',
      protocol: 'opencode-go',
      baseUrl: 'https://opencode.ai/inference/go/openai/v1'
    }),
    jsonFetch(
      {
        usage: {
          rolling: { percent: 41, resetsAt: '2026-02-01T05:00:00.000Z' },
          weekly: { percent: 12, resets_at: '2026-02-03T00:00:00.000Z', status: 'ok' },
          monthly: { percent: 3 }
        }
      },
      (target) => {
        url = target
      }
    )
  )
  assert.equal(url, 'https://opencode.ai/inference/go/v1/usage')
  assert.equal(usage.kind, 'quota-windows')
  assert.deepEqual(
    usage.windows?.map((item) => [item.window, item.percent, item.resetsAt]),
    [
      ['rolling', 41, '2026-02-01T05:00:00.000Z'],
      ['weekly', 12, '2026-02-03T00:00:00.000Z'],
      ['monthly', 3, null]
    ]
  )
})

test('没有官方余额接口的服务商诚实返回 unsupported', async () => {
  const usage = await fetchProviderUsage(
    account({ id: 'openai', protocol: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' })
  )
  assert.equal(usage.kind, 'unsupported')
  assert.equal(usage.available, false)
  assert.match(usage.note ?? '', /Token 账本/)
})

test('平台返回非 2xx 时抛错，由 ipc 归一成 E_UPSTREAM', async () => {
  const failing = (async () => new Response('nope', { status: 500 })) as typeof fetch
  await assert.rejects(
    () => fetchProviderModels(account({}), failing),
    /E_HTTP_500/
  )
})
