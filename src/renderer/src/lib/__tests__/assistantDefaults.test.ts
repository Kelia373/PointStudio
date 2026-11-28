// 契约测试：内置通用助手在渲染层的兜底合成。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_ASSISTANT_ID, type AssistantDto } from '../../../../shared/types/ipc.ts'
import { withBuiltinAssistant } from '../assistantDefaults.ts'

const NOW = '2026-11-29T00:00:00.000Z'

function agent(id: string, name: string): AssistantDto {
  return {
    id,
    name,
    systemPrompt: '',
    providerId: null,
    modelId: null,
    params: { temperature: 0.7, maxTokens: 2048, topP: 1 },
    createdAt: NOW,
    updatedAt: NOW
  }
}

test('列表里没有内置助手时补一条：置顶、空提示词、builtin', () => {
  const list = withBuiltinAssistant([agent('a1', '架构')], NOW)
  assert.equal(list.length, 2)
  assert.equal(list[0].id, DEFAULT_ASSISTANT_ID)
  assert.equal(list[0].name, '通用助手')
  assert.equal(list[0].builtin, true)
  assert.equal(list[0].systemPrompt, '')
  assert.equal(list[0].enabled, true)
  assert.equal(list[1].id, 'a1', '原有顺序不变')
})

test('已经存在就不重复合成，也不覆盖用户改过的那条', () => {
  const modified: AssistantDto = {
    ...agent(DEFAULT_ASSISTANT_ID, '我的通用助手'),
    builtin: true,
    modelId: 'deepseek-chat'
  }
  const list = withBuiltinAssistant([modified, agent('a1', '架构')], NOW)
  assert.equal(list.length, 2)
  assert.equal(list[0].name, '我的通用助手')
  assert.equal(list[0].modelId, 'deepseek-chat')
})

test('空列表也能拿到一条可用 Agent', () => {
  const list = withBuiltinAssistant([], NOW)
  assert.equal(list.length, 1)
  assert.equal(list[0].id, DEFAULT_ASSISTANT_ID)
  assert.equal(list[0].params.maxTokens, 2048)
})
