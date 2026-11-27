// 契约测试：模型输出的计划解析（围栏 JSON、裸 JSON、夹带解释文字、结构非法）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildPlanPrompt, parsePlanResponse } from '../planPrompt.ts'

const VALID = {
  goal: '查一下当前时间并算个数',
  assumptions: ['用户在中国'],
  steps: [
    { id: '1', action: '取时间', tool: 'now', expect: '返回 ISO 时间', risk: 'low' },
    { id: '2', action: '算 1+2', tool: 'calc', input: { expression: '1+2' }, expect: '结果 3', risk: 'low' }
  ],
  stopConditions: ['工具连续失败两次'],
  rollback: '什么都不改，直接回报失败'
}

test('能从 ```json 围栏里取出计划', () => {
  const text = `好的，计划如下：\n\n\`\`\`json\n${JSON.stringify(VALID, null, 2)}\n\`\`\`\n\n请确认。`
  const result = parsePlanResponse(text)

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.goal, VALID.goal)
    assert.equal(result.value.steps.length, 2)
    assert.equal(result.value.steps[1].tool, 'calc')
  }
})

test('裸 JSON 也能解析', () => {
  const result = parsePlanResponse(JSON.stringify(VALID))
  assert.equal(result.ok, true)
})

test('前后夹着解释文字时，取第一段平衡的 JSON', () => {
  const text = `我先说两句 {这不是 json} 然后才是正式的：${JSON.stringify(VALID)} 结束。`
  const result = parsePlanResponse(text)
  assert.equal(result.ok, true)
})

test('完全不是 JSON 时给出 E_PLAN_JSON_INVALID，而不是抛异常', () => {
  const result = parsePlanResponse('我觉得可以分三步走。')
  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_PLAN_JSON_INVALID'))
  }
})

test('JSON 合法但不满足计划协议时，把协议错误码带出来', () => {
  const invalid = { goal: '', steps: [{ action: '做', expect: '', risk: 'low' }], stopConditions: [] }
  const result = parsePlanResponse(JSON.stringify(invalid))

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_GOAL_REQUIRED'))
    assert.ok(result.errors.includes('E_STEP_EXPECT_REQUIRED'))
    assert.ok(result.errors.includes('E_STOP_REQUIRED'))
  }
})

test('提示词里带上目标、可用工具与协议要点', () => {
  const prompt = buildPlanPrompt('统计今天的消息', [
    { name: 'now', description: '返回当前时间', sideEffect: 'read-only', requiresApproval: false, params: [] },
    { name: 'require', description: '对外请求', sideEffect: 'external', requiresApproval: true, params: ['url'] }
  ])

  assert.ok(prompt.includes('统计今天的消息'))
  assert.ok(prompt.includes('now'))
  assert.ok(prompt.includes('external'))
  assert.ok(prompt.includes('expect'))
  assert.ok(prompt.includes('stopConditions'))
  assert.ok(prompt.includes('JSON'))
})
