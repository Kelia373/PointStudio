// 契约测试：模型选项与「思考等级 ↔ 输出预算」的换算。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AUTO_ROUTE_MODEL,
  EFFORT_MAX_TOKENS,
  MODEL_LABEL,
  effortFromMaxTokens,
  modelChoices,
  modelSelectOptions
} from '../modelOptions.ts'

test('等级换算：低/中/高对应 1k/2k/4k', () => {
  assert.equal(EFFORT_MAX_TOKENS.low, 1024)
  assert.equal(EFFORT_MAX_TOKENS.mid, 2048)
  assert.equal(EFFORT_MAX_TOKENS.high, 4096)
})

test('从 maxTokens 反推等级', () => {
  assert.equal(effortFromMaxTokens(2048), 'mid')
  assert.equal(effortFromMaxTokens(4096), 'high')
})

test('未设置或非预设值返回 null（界面显示默认）', () => {
  assert.equal(effortFromMaxTokens(undefined), null)
  assert.equal(effortFromMaxTokens(3000), null)
})

test('模型下拉：当前值排第一，平台预设跟在后面且不重复', () => {
  assert.deepEqual(modelChoices('deepseek', 'deepseek-chat'), [
    'deepseek-chat',
    'deepseek-reasoner'
  ])
  assert.deepEqual(modelChoices('deepseek', 'my-custom'), ['my-custom', 'deepseek-chat', 'deepseek-reasoner'])
})

test('没有当前值也没有平台时不返回空字符串项', () => {
  assert.deepEqual(modelChoices(null, null), [])
  assert.deepEqual(modelChoices('unknown-provider', ''), [])
})

test('下拉第一项固定是协同路由，后面才是真实模型名', () => {
  const options = modelSelectOptions('deepseek', 'deepseek-chat')
  assert.equal(options[0], AUTO_ROUTE_MODEL)
  assert.deepEqual(options.slice(1), ['deepseek-chat', 'deepseek-reasoner'])
})

test('协同路由有自己的中文标签，不是把哨兵值直接怼到界面上', () => {
  assert.equal(MODEL_LABEL[AUTO_ROUTE_MODEL], '🐼 Auto · 协同路由')
  assert.equal(MODEL_LABEL['deepseek-chat'], undefined)
})
