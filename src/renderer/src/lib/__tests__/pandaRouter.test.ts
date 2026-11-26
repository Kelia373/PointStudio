// 契约测试：难度估计、升级阶梯与徽章文案。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEscalationLadder,
  estimateDifficulty,
  formatRouteTick,
  nextAttempt,
  type RouteLadder
} from '../pandaRouter.ts'

test('短问题判为简单闲聊', () => {
  const difficulty = estimateDifficulty('今天天气怎么样')
  assert.equal(difficulty.level, 1)
  assert.equal(difficulty.category, 'chat')
})

test('带代码块与多步要求的判为难', () => {
  const difficulty = estimateDifficulty(
    '把这个模块重构一下：先拆接口，再补测试\n```ts\nconst a = 1\n```\n最后跑一遍构建'
  )
  assert.equal(difficulty.level, 3)
  assert.equal(difficulty.category, 'code')
})

test('中等长度、有步骤词但没代码的判为中等', () => {
  const difficulty = estimateDifficulty('帮我梳理一下这个需求的边界，然后给出验收清单，注意要和现有实现对齐')
  assert.equal(difficulty.level, 2)
})

test('难度越高阶梯越长，且成功率逐级上升、成本逐级增加', () => {
  const easy = buildEscalationLadder(1, ['cheap', 'mid', 'strong'])
  const hard = buildEscalationLadder(3, ['cheap', 'mid', 'strong'])

  assert.equal(easy.length, 1)
  assert.equal(hard.length, 3)
  assert.ok(hard[0].pSuccess < hard[1].pSuccess)
  assert.ok((hard[0].estCostUsd ?? 0) < (hard[2].estCostUsd ?? 0))
})

test('还有下一级时给下一步，到底了返回 null', () => {
  const ladder: RouteLadder = buildEscalationLadder(2, ['cheap', 'strong'])
  const first = nextAttempt(ladder, 0)
  assert.equal(first?.model, 'strong')
  assert.equal(nextAttempt(ladder, ladder.length - 1), null)
})

test('徽章文案包含等级、类别、模型与置信度', () => {
  const tick = formatRouteTick({
    level: 2,
    category: 'code',
    model: 'claude-sonnet',
    confidence: 0.78
  })
  assert.equal(tick, 'L2 · code · claude-sonnet · 78%')
})
