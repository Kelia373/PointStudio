// 契约测试：模型选择浮层的排序 / 过滤 / 能力 / 输入栏策略。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  createDefaultModelServicesState,
  parseModelServicesState,
  serializeModelServicesState
} from '../modelServices.ts'
import type {
  ModelCapabilitiesDto,
  ProviderAccountViewDto,
  ReasoningEffortDto
} from '../../../../shared/types/ipc.ts'
import {
  EFFORT_DISPLAY_ORDER,
  EFFORT_SHORT_LABEL,
  filterPickerModels,
  inferRendererCapabilities,
  mergeDiscoveredIntoServices,
  resolveComposerModelPolicy,
  resolveConversationComposerPolicy,
  resolvePickerModelCapabilities,
  sortPickerProviders
} from '../modelPicker.ts'

function account(
  providerId: string,
  overrides: Partial<ProviderAccountViewDto> = {}
): ProviderAccountViewDto {
  return {
    providerId,
    protocol: 'openai-compatible',
    hasKey: true,
    maskedKey: 'sk-t****1234',
    baseUrl: 'https://x/v1',
    defaultModel: 'm',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides
  }
}

test('输入栏策略：小组锁死、单 Agent 锁死、自由对话可编辑', () => {
  assert.equal(
    resolveComposerModelPolicy({ assistantId: null, inGroup: true }).mode,
    'locked-group'
  )
  assert.equal(
    resolveComposerModelPolicy({ assistantId: 'a1', inGroup: false }).mode,
    'locked-agent'
  )
  assert.equal(
    resolveComposerModelPolicy({ assistantId: null, inGroup: false }).mode,
    'editable'
  )
})

test('来源轨排序：已配通在前，未配通在后，组内保持目录顺序', () => {
  const services = createDefaultModelServicesState()
  const providers = sortPickerProviders(services, [account('opencode-go')])
  assert.equal(providers[0].providerId, 'opencode-go')
  assert.equal(providers[0].ready, true)
  assert.equal(providers.filter((item) => item.ready).length, 1)
  assert.equal(providers[1].providerId, 'deepseek')
  assert.equal(providers[1].ready, false)
  // 其余顺序与目录一致
  const ids = providers.map((item) => item.providerId)
  assert.deepEqual(
    ids.slice(2),
    services.api.slice(2).map((item) => item.id).concat(services.local.map((item) => item.id))
  )
})

test('本地 Ollama 免 Key 也算已配通；LM Studio 未配不通', () => {
  const services = createDefaultModelServicesState()
  const providers = sortPickerProviders(services, [
    account('ollama', { protocol: 'ollama', hasKey: false })
  ])
  assert.equal(providers[0].providerId, 'ollama')
  assert.equal(providers[0].ready, true)
  const lm = providers.find((item) => item.providerId === 'lm-studio')
  assert.equal(lm?.ready, false)
  assert.equal(lm?.supported, false)
})

test('模型过滤：大小写不敏感，空查询原样返回', () => {
  const models = [{ id: 'Claude-Sonnet-4-5', capabilities: inferRendererCapabilities('opencode-go', 'claude-sonnet-4-5'), disabledReason: null }]
  assert.equal(filterPickerModels(models, 'claude').length, 1)
  assert.equal(filterPickerModels(models, 'SONNET').length, 1)
  assert.equal(filterPickerModels(models, 'gpt').length, 0)
  assert.equal(filterPickerModels(models, '  ').length, 1)
})

test('能力：优先读拉取缓存，没有则按规则推断', () => {
  const services = createDefaultModelServicesState()
  assert.equal(
    resolvePickerModelCapabilities(services, 'deepseek', 'deepseek-reasoner').effortMode,
    'fixed'
  )
  const cached: ModelCapabilitiesDto = {
    supportsTools: true,
    supportedEfforts: ['low', 'mid', 'high'],
    effortMode: 'reasoning_effort'
  }
  const withCache = {
    ...services,
    api: services.api.map((provider) =>
      provider.id === 'deepseek'
        ? { ...provider, modelCapabilities: { 'deepseek-chat': cached } }
        : provider
    )
  }
  assert.deepEqual(
    resolvePickerModelCapabilities(withCache, 'deepseek', 'deepseek-chat').supportedEfforts,
    ['low', 'mid', 'high']
  )
})

test('拉取结果写回：模型、能力、不可选原因、默认模型回落', () => {
  const services = createDefaultModelServicesState()
  const merged = mergeDiscoveredIntoServices(services, 'opencode-go', [
    { id: 'kimi-k2.5', selectable: true },
    { id: 'claude-sonnet-4-5', selectable: true },
    { id: 'glm-4.5-free', selectable: false, note: '仅官方客户端' }
  ])
  const provider = merged.api.find((item) => item.id === 'opencode-go')
  assert.deepEqual(provider?.models, ['kimi-k2.5', 'claude-sonnet-4-5'])
  assert.equal(provider?.unselectableModels?.['glm-4.5-free'], '仅官方客户端')
  assert.equal(provider?.modelCapabilities?.['claude-sonnet-4-5'].effortMode, 'thinking_budget')
  assert.equal(provider?.defaultModel, 'kimi-k2.5')

  const empty = mergeDiscoveredIntoServices(services, 'deepseek', [])
  assert.equal(empty.api.find((item) => item.id === 'deepseek')?.defaultModel, '')
})

test('档位顺序与短标稳定（默认 · Low · Med · High · XHigh · Max）', () => {
  assert.deepEqual(EFFORT_DISPLAY_ORDER, ['low', 'mid', 'high', 'xhigh', 'max'])
  assert.deepEqual(EFFORT_SHORT_LABEL, {
    low: 'Low',
    mid: 'Med',
    high: 'High',
    xhigh: 'XHigh',
    max: 'Max'
  })
})

test('会话级 groupId 才锁小组；成员的一对一会话仍可编辑', () => {
  assert.equal(
    resolveConversationComposerPolicy({ assistantId: 'a1', groupId: 'g-1' }).mode,
    'locked-group'
  )
  // 即使这个 Agent 属于某个小组，只要会话没有 groupId，它的一对一不被锁
  assert.equal(
    resolveConversationComposerPolicy({ assistantId: 'a1', groupId: null }).mode,
    'locked-agent'
  )
  assert.equal(
    resolveConversationComposerPolicy({ assistantId: null, groupId: null }).mode,
    'editable'
  )
})

test('杠杆 P2-1：不可直选模型仍出现在列表里，灰显带原因', () => {
  const services = createDefaultModelServicesState()
  const merged = mergeDiscoveredIntoServices(services, 'opencode-go', [
    { id: 'kimi-k2.5', selectable: true },
    { id: 'glm-4.5-free', selectable: false, note: '仅官方客户端' }
  ])
  const providers = sortPickerProviders(merged, [account('opencode-go')])
  const opencode = providers.find((item) => item.providerId === 'opencode-go')
  const free = opencode?.models.find((item) => item.id === 'glm-4.5-free')
  assert.equal(free?.disabledReason, '仅官方客户端')
  assert.equal(free?.capabilities.supportsTools, false)
})

test('跨端规则一致性：主进程与渲染层对同一批模型推断结果相同', async () => {
  const { inferModelCapabilities } = await import('../../../../main/ai/providers/modelCapabilities.ts')
  const { inferRendererCapabilities } = await import('../modelPicker.ts')
  const samples = [
    ['deepseek', 'deepseek-chat'],
    ['deepseek', 'deepseek-reasoner'],
    ['openai', 'o3'],
    ['openai', 'gpt-5.2'],
    ['opencode-go', 'claude-sonnet-4-5'],
    ['gemini', 'gemini-2.5-pro'],
    ['moonshot', 'kimi-thinking'],
    ['qwen', 'qwq-32b'],
    ['zhipu', 'glm-z1-air'],
    ['mistral', 'mistral-large-latest'],
    ['siliconflow', 'bge-m3-embed']
  ] as const
  for (const [providerId, modelId] of samples) {
    assert.deepEqual(
      inferRendererCapabilities(providerId, modelId),
      inferModelCapabilities(providerId, modelId),
      `${providerId}/${modelId} 两端推断不一致`
    )
  }
})

test('P2-B：OpenAI 兼容来源只亮三档，opencode-go 的 Claude 仍五档', () => {
  const services = createDefaultModelServicesState()
  const openrouter = services.api.find((item) => item.id === 'openrouter')
  assert.ok(openrouter)
  const openaiLine = resolvePickerModelCapabilities(
    { ...services, api: services.api.map((item) => item.id === 'openrouter' ? { ...item, models: [...item.models, 'claude-sonnet-4.5'] } : item) },
    'openrouter',
    'claude-sonnet-4.5'
  )
  assert.deepEqual(openaiLine.supportedEfforts, ['low', 'mid', 'high'])

  const anthropicLine = resolvePickerModelCapabilities(
    services,
    'opencode-go',
    'claude-sonnet-4-5'
  )
  assert.deepEqual(anthropicLine.supportedEfforts, ['low', 'mid', 'high', 'xhigh', 'max'])
})

test('P2-A 已知边界：能力画像不持久化，unselectable 标记保留', () => {
  const services = createDefaultModelServicesState()
  const marked = {
    ...services,
    api: services.api.map((provider) =>
      provider.id === 'openrouter'
        ? {
            ...provider,
            models: ['a'],
            modelCapabilities: {
              a: { supportsTools: true, supportedEfforts: ['low', 'mid', 'high'] as ReasoningEffortDto[], effortMode: 'reasoning_effort' as const }
            }
          }
        : provider
    )
  }
  const parsed = parseModelServicesState(serializeModelServicesState(marked))
  const provider = parsed.api.find((item) => item.id === 'openrouter')
  assert.equal(provider?.modelCapabilities, undefined, '重启后两侧一起回退规则表')
})

test('P2-A：unselectableModels 仍持久化，-free 灰显不因重启丢失', () => {
  const services = createDefaultModelServicesState()
  const marked = {
    ...services,
    api: services.api.map((provider) =>
      provider.id === 'opencode-go'
        ? { ...provider, unselectableModels: { 'glm-4.5-free': '仅官方客户端' } }
        : provider
    )
  }
  const parsed = parseModelServicesState(serializeModelServicesState(marked))
  assert.equal(
    parsed.api.find((item) => item.id === 'opencode-go')?.unselectableModels?.['glm-4.5-free'],
    '仅官方客户端'
  )
})

test('P3-2：serialize 不写能力画像，但保留 unselectableModels', () => {
  const services = createDefaultModelServicesState()
  const marked = {
    ...services,
    api: services.api.map((provider) =>
      provider.id === 'opencode-go'
        ? {
            ...provider,
            modelCapabilities: {
              'kimi-k2.5': {
                supportsTools: true,
                supportedEfforts: ['low', 'mid', 'high'] as ReasoningEffortDto[],
                effortMode: 'reasoning_effort' as const
              }
            },
            unselectableModels: { 'glm-4.5-free': '仅官方客户端' }
          }
        : provider
    )
  }
  const raw = serializeModelServicesState(marked)
  assert.equal(raw.includes('modelCapabilities'), false, '能力画像不落 localStorage')
  assert.equal(raw.includes('unselectableModels'), true, '不可选标记仍保留')
})

test('全员归属模式：单聊一律锁模型，无主会话按兜底 Agent 锁', () => {
  assert.equal(
    resolveConversationComposerPolicy({ assistantId: null, groupId: null, defaultAssistantId: 'builtin' })
      .mode,
    'locked-agent'
  )
  assert.equal(
    resolveConversationComposerPolicy({ assistantId: 'a1', groupId: null, defaultAssistantId: 'builtin' })
      .mode,
    'locked-agent'
  )
  assert.equal(
    resolveConversationComposerPolicy({ assistantId: 'a1', groupId: 'g1', defaultAssistantId: 'builtin' })
      .mode,
    'locked-group'
  )
})
