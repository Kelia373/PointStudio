// 契约测试：计划执行循环（逐步执行、失败策略、确认门、状态推进）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { executePlan } from '../executor.ts'
import { createPlan, type Plan, type PlanDraft } from '../plan.ts'
import { ToolRegistry } from '../../tools/registry.ts'
import type { ToolDefinition } from '../../tools/types.ts'

const NOW = '2026-01-01T00:00:00.000Z'

function plan(overrides: Partial<PlanDraft> = {}): Plan {
  return createPlan(
    {
      goal: '做一件事',
      steps: [
        { action: '第一步', tool: 'echo', expect: '有输出', risk: 'low' },
        { action: '第二步', tool: 'echo', expect: '有输出', risk: 'low' }
      ],
      stopConditions: ['出任何错就停'],
      ...overrides
    },
    { now: NOW }
  )
}

function registry(tools: Array<Partial<ToolDefinition> & { name: string }>): ToolRegistry {
  const r = new ToolRegistry()
  for (const tool of tools) {
    r.register({
      description: 'test tool',
      sideEffect: 'read-only',
      params: {},
      async handler() {
        return { ok: true, value: 'done' }
      },
      ...tool
    } as ToolDefinition)
  }
  return r
}

test('全部步骤成功：状态全为 success，按顺序调用工具', async () => {
  const calls: unknown[] = []
  const tools = registry([
    {
      name: 'echo',
      async handler(input) {
        calls.push(input)
        return { ok: true, value: 'ok' }
      }
    }
  ])

  const result = await executePlan(plan(), { tools })

  assert.equal(result.status, 'completed')
  assert.deepEqual(
    result.plan.steps.map((step) => step.status),
    ['success', 'success']
  )
  assert.equal(calls.length, 2)
})

test('步骤的 input 会透传给工具', async () => {
  const received: unknown[] = []
  const tools = registry([
    {
      name: 'echo',
      async handler(input) {
        received.push(input)
        return { ok: true, value: null }
      }
    }
  ])

  await executePlan(
    plan({
      steps: [{ action: '带参数', tool: 'echo', input: { text: '喂进去' }, expect: '收到', risk: 'low' }]
    }),
    { tools }
  )

  assert.deepEqual(received, [{ text: '喂进去' }])
})

test('某步失败时默认停止，后续步骤保持 pending', async () => {
  const tools = registry([
    {
      name: 'echo',
      async handler() {
        return { ok: false, code: 'E_TOOL_FAILED' }
      }
    }
  ])

  const result = await executePlan(plan(), { tools })

  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'E_TOOL_FAILED')
  assert.deepEqual(
    result.plan.steps.map((step) => step.status),
    ['failed', 'pending'],
    '第一步失败，第二步不该被执行'
  )
})

test('失败策略为 continue 时继续执行后续步骤', async () => {
  let calls = 0
  const tools = registry([
    {
      name: 'echo',
      async handler() {
        calls += 1
        return calls === 1 ? { ok: false, code: 'E_TOOL_FAILED' } : { ok: true, value: 'ok' }
      }
    }
  ])

  const result = await executePlan(plan(), { tools, onFailure: 'continue' })

  // 原断言写的是 'completed'，那是错的：所有步骤都走完了，但确实有一步失败，
  // 「跑完」不等于「成功」。状态必须是 failed 并把错误码带出来，
  // 否则上层会以为计划顺利结束。
  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'E_TOOL_FAILED')
  assert.deepEqual(
    result.plan.steps.map((step) => step.status),
    ['failed', 'success']
  )
  assert.equal(calls, 2, 'continue 策略下后续步骤必须真的被执行')
})

test('高风险步骤没有确认时，整份计划一步都不执行', async () => {
  let calls = 0
  const tools = registry([
    {
      name: 'echo',
      async handler() {
        calls += 1
        return { ok: true, value: 'ok' }
      }
    }
  ])

  const risky = plan({
    steps: [
      { action: '安全步骤', tool: 'echo', expect: 'ok', risk: 'low' },
      { action: '写文件', tool: 'echo', expect: 'ok', risk: 'high' }
    ]
  })

  const result = await executePlan(risky, { tools })

  assert.equal(result.status, 'stopped')
  assert.equal(result.reason, 'E_STEP_NEEDS_CONFIRMATION')
  assert.equal(calls, 0, '确认门必须在任何副作用之前拦下')
  assert.deepEqual(
    result.plan.steps.map((step) => step.status),
    ['pending', 'pending']
  )
})

test('高风险步骤已确认时正常执行', async () => {
  const tools = registry([{ name: 'echo' }])
  const risky = plan({
    steps: [{ action: '写文件', tool: 'echo', expect: 'ok', risk: 'high' }]
  })

  const result = await executePlan(risky, { tools, confirmedStepIds: ['1'] })

  assert.equal(result.status, 'completed')
  assert.equal(result.plan.steps[0].status, 'success')
})

test('没有工具的步骤标记为 skipped，不算失败', async () => {
  const tools = registry([{ name: 'echo' }])

  const result = await executePlan(
    plan({
      steps: [
        { action: '人来做的一步', expect: '人工完成', risk: 'low' },
        { action: '调工具', tool: 'echo', expect: 'ok', risk: 'low' }
      ]
    }),
    { tools }
  )

  assert.equal(result.status, 'completed')
  assert.deepEqual(
    result.plan.steps.map((step) => step.status),
    ['skipped', 'success']
  )
})

test('引用了不存在的工具时该步失败，并归类为 E_TOOL_NOT_FOUND', async () => {
  const tools = registry([])
  const result = await executePlan(plan({ steps: [{ action: 'x', tool: 'nope', expect: 'y', risk: 'low' }] }), {
    tools
  })

  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'E_TOOL_NOT_FOUND')
})

test('每一步状态变化都会回调，拿到的是推进后的计划', async () => {
  const seen: string[][] = []
  const tools = registry([{ name: 'echo' }])

  await executePlan(plan(), {
    tools,
    onStepChange: (current) => {
      seen.push(current.steps.map((step) => step.status))
    }
  })

  assert.deepEqual(seen, [
    ['running', 'pending'],
    ['success', 'pending'],
    ['success', 'running'],
    ['success', 'success']
  ])
})

test('步骤结果里记下用了哪个工具、耗时多少（供界面显示详情）', async () => {
  const tools = registry([
    {
      name: 'echo',
      async handler() {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return { ok: true, value: 'ok' }
      }
    }
  ])

  const result = await executePlan(plan(), { tools })

  assert.equal(result.stepResults.length, 2)
  for (const outcome of result.stepResults) {
    assert.equal(outcome.tool, 'echo')
    assert.ok((outcome.durationMs ?? -1) >= 0, '成功步骤要有耗时')
    assert.equal(outcome.code, undefined)
  }
})

test('失败步骤的详情里带错误码与耗时', async () => {
  const tools = registry([
    {
      name: 'echo',
      async handler() {
        return { ok: false, code: 'E_TOOL_TIMEOUT' }
      }
    }
  ])

  const result = await executePlan(plan(), { tools })
  assert.equal(result.stepResults[0].status, 'failed')
  assert.equal(result.stepResults[0].code, 'E_TOOL_TIMEOUT')
  assert.equal(result.stepResults[0].tool, 'echo')
  assert.ok((result.stepResults[0].durationMs ?? -1) >= 0)
})

test('没有工具的步骤不记工具与耗时', async () => {
  const tools = registry([{ name: 'echo' }])
  const result = await executePlan(
    plan({ steps: [{ action: '人来做', expect: '人工完成', risk: 'low' }] }),
    { tools }
  )

  assert.equal(result.stepResults[0].status, 'skipped')
  assert.equal(result.stepResults[0].tool, undefined)
  assert.equal(result.stepResults[0].durationMs, undefined)
})
