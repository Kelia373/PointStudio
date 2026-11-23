// 契约测试：计划生成服务（调模型 → 解析 → 校验 → 带错误重试）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { generatePlan, replanAfterFailure } from '../planService.ts'
import { ToolRegistry } from '../../ai/tools/registry.ts'
import type { ChatProvider, ChatStreamRequest } from '../../ai/providers/types.ts'
import type { ToolDefinition } from '../../ai/tools/types.ts'

const NOW = (): string => '2026-01-01T00:00:00.000Z'

const VALID_PLAN = {
  goal: '查时间',
  steps: [{ action: '取时间', tool: 'now', expect: '拿到 ISO 时间', risk: 'low' }],
  stopConditions: ['工具失败']
}

function tools(): ToolRegistry {
  const registry = new ToolRegistry()
  registry.register({
    name: 'now',
    description: '返回当前时间',
    sideEffect: 'read-only',
    params: {},
    async handler() {
      return { ok: true, value: { iso: 'x' } }
    }
  } as ToolDefinition)
  return registry
}

function providerOf(replies: string[], seen: ChatStreamRequest[]): ChatProvider {
  return {
    id: 'fake',
    async *streamChat(request: ChatStreamRequest): AsyncGenerator<string> {
      seen.push(request)
      const reply = replies[Math.min(seen.length - 1, replies.length - 1)]
      // 分块吐出，顺带验证累加逻辑
      for (const piece of reply.match(/[\s\S]{1,20}/g) ?? []) {
        yield piece
      }
    }
  }
}

const engine = (provider: ChatProvider) => ({
  provider,
  apiKey: 'k',
  baseUrl: 'https://example.invalid',
  model: 'm'
})

test('模型给出合法计划时生成成功，并注入 createdAt', async () => {
  const seen: ChatStreamRequest[] = []
  const result = await generatePlan('查时间', {
    engine: engine(providerOf([JSON.stringify(VALID_PLAN)], seen)),
    tools: tools(),
    now: NOW
  })

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.goal, '查时间')
    assert.equal(result.value.createdAt, '2026-01-01T00:00:00.000Z')
    assert.equal(result.value.steps[0].status, 'pending')
  }
  assert.equal(seen.length, 1)
})

test('提示词里带上目标与可用工具', async () => {
  const seen: ChatStreamRequest[] = []
  await generatePlan('查时间', {
    engine: engine(providerOf([JSON.stringify(VALID_PLAN)], seen)),
    tools: tools(),
    now: NOW
  })

  const prompt = seen[0].messages[seen[0].messages.length - 1].content
  assert.ok(prompt.includes('查时间'))
  assert.ok(prompt.includes('now'))
})

test('首次输出不合协议时，带着错误码重试一次', async () => {
  const seen: ChatStreamRequest[] = []
  const bad = JSON.stringify({ goal: 'x', steps: [], stopConditions: [] })

  const result = await generatePlan('查时间', {
    engine: engine(providerOf([bad, JSON.stringify(VALID_PLAN)], seen)),
    tools: tools(),
    now: NOW
  })

  assert.equal(result.ok, true)
  assert.equal(seen.length, 2, '应当重试一次')
  const retryPrompt = seen[1].messages[seen[1].messages.length - 1].content
  assert.ok(retryPrompt.includes('E_STEPS_REQUIRED'), '重试提示里要带上具体错误')
})

test('多次都不合规时返回错误码，且不超过尝试上限', async () => {
  const seen: ChatStreamRequest[] = []
  const result = await generatePlan('查时间', {
    engine: engine(providerOf(['完全不是 JSON'], seen)),
    tools: tools(),
    now: NOW,
    maxAttempts: 3
  })

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.length > 0)
  }
  assert.equal(seen.length, 3, '尝试次数应等于上限')
})

test('无可用 Key 时（本地假回复）也走同一条路径，最终返回解析失败而不是崩', async () => {
  const seen: ChatStreamRequest[] = []
  const result = await generatePlan('查时间', {
    engine: { ...engine(providerOf(['忽略'], seen)), apiKey: null },
    tools: tools(),
    now: NOW,
    maxAttempts: 1
  })

  assert.equal(result.ok, false)
  assert.equal(seen.length, 0, '无 Key 时不该发起真实请求')
})

const REVISED = {
  goal: '查时间',
  steps: [
    { action: '换一种方式取时间', tool: 'now', expect: '拿到 ISO 时间', risk: 'low' },
    { action: '算 1+2', tool: null, expect: '结果 3', risk: 'low' }
  ],
  stopConditions: ['再失败就停下来问人']
}

async function failedPlan() {
  const seen: ChatStreamRequest[] = []
  const result = await generatePlan('查时间', {
    engine: engine(providerOf([JSON.stringify(VALID_PLAN)], seen)),
    tools: tools(),
    now: NOW
  })
  if (!result.ok) {
    throw new Error('前置计划生成失败')
  }
  return result.value
}

test('重规划：把失败现场交给模型，返回修订后的新计划', async () => {
  const plan = await failedPlan()
  const seen: ChatStreamRequest[] = []

  const result = await replanAfterFailure(
    { plan, failedStepId: '1', errorCode: 'E_TOOL_TIMEOUT' },
    { engine: engine(providerOf([JSON.stringify(REVISED)], seen)), tools: tools(), now: NOW }
  )

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.steps.length, 2)
    assert.equal(result.value.steps[0].action, '换一种方式取时间')
  }

  const prompt = seen[0].messages[seen[0].messages.length - 1].content
  assert.ok(prompt.includes('E_TOOL_TIMEOUT'), '要把错误码告诉模型')
  assert.ok(prompt.includes('失败步骤：1'), '要指出是哪一步失败')
  // 检查原计划的实质内容被带上，而不是对措辞做字面断言（措辞会改，内容不会）。
  assert.ok(prompt.includes('拿到 ISO 时间'), '要带上原计划的步骤内容')
  assert.ok(prompt.includes('"status"'), '要带上每步的执行状态')
})

test('重规划不会修改传进来的旧计划', async () => {
  const plan = await failedPlan()
  const before = JSON.stringify(plan)
  const seen: ChatStreamRequest[] = []

  await replanAfterFailure(
    { plan, failedStepId: '1', errorCode: 'E_TOOL_FAILED' },
    { engine: engine(providerOf([JSON.stringify(REVISED)], seen)), tools: tools(), now: NOW }
  )

  assert.equal(JSON.stringify(plan), before, '旧计划是历史快照，不能被就地改写')
})

test('重规划也走带错重试；多次不合规时返回错误码', async () => {
  const plan = await failedPlan()
  const seen: ChatStreamRequest[] = []

  const result = await replanAfterFailure(
    { plan, failedStepId: '1', errorCode: 'E_TOOL_FAILED' },
    {
      engine: engine(providerOf(['不是 JSON'], seen)),
      tools: tools(),
      now: NOW,
      maxAttempts: 2
    }
  )

  assert.equal(result.ok, false)
  assert.equal(seen.length, 2)
})
