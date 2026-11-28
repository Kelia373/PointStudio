// 契约测试：模型能力画像（拒绝假档位）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  capabilitiesForSelectable,
  inferModelCapabilities
} from '../modelCapabilities.ts'

test('DeepSeek：chat 不可调档，reasoner 固定开启思考', () => {
  const chat = inferModelCapabilities('deepseek', 'deepseek-chat')
  assert.deepEqual(chat.supportedEfforts, [])
  assert.equal(chat.effortMode, 'none')
  assert.equal(chat.supportsTools, true)

  const reasoner = inferModelCapabilities('deepseek', 'deepseek-reasoner')
  assert.deepEqual(reasoner.supportedEfforts, [])
  assert.equal(reasoner.effortMode, 'fixed')
})

test('OpenAI 推理族：三档 reasoning_effort，gpt-5.2 / codex 多一档 xhigh', () => {
  const o3 = inferModelCapabilities('openai', 'o3')
  assert.deepEqual(o3.supportedEfforts, ['low', 'mid', 'high'])
  assert.equal(o3.effortMode, 'reasoning_effort')

  const gpt5 = inferModelCapabilities('openai', 'gpt-5.1')
  assert.deepEqual(gpt5.supportedEfforts, ['low', 'mid', 'high'])

  const wide = inferModelCapabilities('openai', 'gpt-5.2')
  assert.deepEqual(wide.supportedEfforts, ['low', 'mid', 'high', 'xhigh'])

  const codex = inferModelCapabilities('openai', 'gpt-5-codex')
  assert.ok(codex.supportedEfforts.includes('xhigh'))
})

test('Claude：五档 thinking_budget；Gemini 2.5：三档 reasoning_effort', () => {
  const claude = inferModelCapabilities('opencode-go', 'claude-sonnet-4-5')
  assert.deepEqual(claude.supportedEfforts, ['low', 'mid', 'high', 'xhigh', 'max'])
  assert.equal(claude.effortMode, 'thinking_budget')

  const gemini = inferModelCapabilities('gemini', 'gemini-2.5-pro')
  assert.deepEqual(gemini.supportedEfforts, ['low', 'mid', 'high'])
  assert.equal(gemini.effortMode, 'reasoning_effort')
})

test('国内推理变体：thinking / qwq / z1 / r1 可调三档；普通模型不可调', () => {
  const kimi = inferModelCapabilities('moonshot', 'kimi-thinking')
  assert.deepEqual(kimi.supportedEfforts, ['low', 'mid', 'high'])
  assert.equal(kimi.effortMode, 'reasoning_effort')

  const qwq = inferModelCapabilities('qwen', 'qwq-32b')
  assert.deepEqual(qwq.supportedEfforts, ['low', 'mid', 'high'])

  const z1 = inferModelCapabilities('zhipu', 'glm-z1-air')
  assert.deepEqual(z1.supportedEfforts, ['low', 'mid', 'high'])

  const plain = inferModelCapabilities('moonshot', 'moonshot-v1-128k')
  assert.deepEqual(plain.supportedEfforts, [])
  assert.equal(plain.effortMode, 'none')
})

test('上游元数据优先：supported_parameters 有 reasoning_effort 就采信', () => {
  const fromMeta = inferModelCapabilities('openai', 'some-model', {
    supported_parameters: ['reasoning_effort', 'tools']
  })
  assert.deepEqual(fromMeta.supportedEfforts, ['low', 'mid', 'high'])
  assert.equal(fromMeta.effortMode, 'reasoning_effort')
  assert.equal(fromMeta.supportsTools, true)

  const reasoningOff = inferModelCapabilities('openai', 'some-model', { reasoning: false })
  assert.deepEqual(reasoningOff.supportedEfforts, [])
  assert.equal(reasoningOff.effortMode, 'none')
})

test('嵌入模型不带工具也不可调档；-free 降级为不可工具', () => {
  const embed = inferModelCapabilities('siliconflow', 'bge-m3-embed')
  assert.equal(embed.supportsTools, false)
  assert.deepEqual(embed.supportedEfforts, [])

  const free = capabilitiesForSelectable(
    inferModelCapabilities('opencode-go', 'glm-4.5'),
    false
  )
  assert.equal(free.supportsTools, false)
  assert.deepEqual(free.supportedEfforts, [])
})

test('发送侧优先用 discovery 缓存的能力（未知长尾模型不再丢参数）', async () => {
  const { capabilitiesForSend, rememberModelCapabilities } = await import(
    '../modelCapabilities.ts'
  )
  // 规则表不认识的模型：默认不可调档
  assert.deepEqual(capabilitiesForSend('openrouter', 'vendor/secret-reasoner').supportedEfforts, [])
  rememberModelCapabilities('openrouter', [
    {
      id: 'vendor/secret-reasoner',
      capabilities: {
        supportsTools: true,
        supportedEfforts: ['low', 'mid', 'high'],
        effortMode: 'reasoning_effort'
      }
    }
  ])
  const cached = capabilitiesForSend('openrouter', 'vendor/secret-reasoner')
  assert.deepEqual(cached.supportedEfforts, ['low', 'mid', 'high'])
  // 别的服务商不会串用
  assert.deepEqual(capabilitiesForSend('deepseek', 'vendor/secret-reasoner').supportedEfforts, [])
})
