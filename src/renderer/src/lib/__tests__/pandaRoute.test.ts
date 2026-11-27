// 契约测试：pandaRouter 的路由决策与升级判定（Step 10 的 UI 侧入口）。
//
// 这一组补的是「选了 🐼 Auto 之后，消息与气泡上要能拿到一个真实决策对象」，
// 以及「什么时候才该出现 ⚡ 升档重试」。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { nextEscalation, planRoute } from '../pandaRouter.ts'
import type { RouteDecisionDto } from '../../../../shared/types/ipc.ts'

const MODELS = ['deepseek-chat', 'deepseek-reasoner', 'claude-sonnet']

test('简单问题：一棒到底，置信度取首棒成功率', () => {
  const route = planRoute('今天天气怎么样', MODELS, { traceId: 't-1' })
  assert.equal(route.chosenModel, 'deepseek-chat')
  assert.equal(route.difficulty.level, 1)
  assert.equal(route.difficulty.category, 'chat')
  assert.equal(route.confidence, 0.6)
  assert.equal(route.attempt, 0)
  assert.equal(route.decidedBy, 'heuristic:local')
  assert.equal(route.traceId, 't-1')
})

test('难问题：阶梯三级都在，首棒仍从最便宜的模型起跑', () => {
  const route = planRoute(
    '把这个模块重构一下：先拆接口，再补测试\n```ts\nconst a = 1\n```\n最后跑一遍构建',
    MODELS,
    { traceId: 't-2' }
  )
  assert.equal(route.difficulty.level, 3)
  assert.equal(route.chosenModel, 'deepseek-chat')
  assert.equal(route.escalationLadder?.length, 3)
  assert.equal(route.escalationLadder?.[2].model, 'claude-sonnet')
})

test('没有候选模型时不编造模型名', () => {
  const route = planRoute('随便聊聊', [], { traceId: 't-3' })
  assert.equal(route.chosenModel, '')
  assert.equal(route.confidence, 0)
  assert.deepEqual(route.escalationLadder, [])
})

test('还有下一棒时给出升档目标，到底返回 null', () => {
  const route = planRoute(
    '把这个模块重构一下：先拆接口，再补测试\n```ts\nconst a = 1\n```\n最后跑一遍构建',
    MODELS,
    { traceId: 't-4' }
  )
  const second = nextEscalation(route)
  assert.equal(second?.chosenModel, 'deepseek-reasoner')
  assert.equal(second?.attempt, 1)
  assert.equal(second?.escalatedFrom, 'deepseek-chat')

  // 已经在最后一棒：不再给「升档重试」
  const last: RouteDecisionDto = { ...route, attempt: 2, chosenModel: 'claude-sonnet' }
  assert.equal(nextEscalation(last), null)
})

test('没有阶梯的旧消息不提供升档', () => {
  assert.equal(nextEscalation(null), null)
  assert.equal(
    nextEscalation({ traceId: 't', chosenModel: 'x', decidedBy: 'static:session', confidence: 0.5, difficulty: { level: 1, category: 'chat' } }),
    null
  )
})
