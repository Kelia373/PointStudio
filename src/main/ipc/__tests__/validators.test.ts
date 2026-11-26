// 契约测试：IPC 边界的运行时校验。
//
// 这些函数此前散在五个 handler 文件里（各自复制同一份 UUID 正则），
// 一行都测不到。抽到无 electron 依赖的模块后即可直接测。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isAgentRunRequest,
  isAssistantDraft,
  isChatSendRequest,
  isCreateConversationRequest,
  isProviderSettingsDraft,
  isUuid,
  isWorkspaceImportPath
} from '../validators.ts'

const UUID = '123e4567-e89b-12d3-a456-426614174000'

test('isUuid：接受标准 UUID（大小写不敏感），拒绝其它', () => {
  assert.equal(isUuid(UUID), true)
  assert.equal(isUuid(UUID.toUpperCase()), true)
  for (const value of ['', 'abc', UUID + 'x', '123e4567-e89b-12d3-a456-42661417400', 42, null, undefined]) {
    assert.equal(isUuid(value), false, String(value))
  }
})

test('isChatSendRequest：id/conversationId 必须是 UUID，text 长度受限', () => {
  assert.equal(isChatSendRequest({ id: UUID, conversationId: UUID, text: '你好' }), true)
  assert.equal(isChatSendRequest({ id: 'x', conversationId: UUID, text: '你好' }), false)
  assert.equal(isChatSendRequest({ id: UUID, conversationId: 'x', text: '你好' }), false)
  assert.equal(isChatSendRequest({ id: UUID, conversationId: UUID, text: 42 }), false)
  assert.equal(isChatSendRequest(null), false)
})

test('isChatSendRequest：超长文本被拒（防一次塞爆上下文）', () => {
  const long = 'x'.repeat(8001)
  assert.equal(isChatSendRequest({ id: UUID, conversationId: UUID, text: long }), false)
})

test('isCreateConversationRequest：缺省允许，title 必须是字符串', () => {
  assert.equal(isCreateConversationRequest(undefined), true)
  assert.equal(isCreateConversationRequest({}), true)
  assert.equal(isCreateConversationRequest({ title: '标题' }), true)
  assert.equal(isCreateConversationRequest({ title: 1 }), false)
  assert.equal(isCreateConversationRequest('x'), false)
})

test('isAssistantDraft：name 必填，可选字段类型要对', () => {
  assert.equal(isAssistantDraft({ name: '助手' }), true)
  assert.equal(isAssistantDraft({ name: '助手', modelId: null }), true)
  assert.equal(isAssistantDraft({ name: 1 }), false)
  assert.equal(isAssistantDraft({}), false)
  assert.equal(isAssistantDraft({ name: 'a', systemPrompt: 2 }), false)
  assert.equal(isAssistantDraft({ name: 'a', params: 'x' }), false)
})

test('isProviderSettingsDraft：apiKey 可省，params 只认数字字段', () => {
  assert.equal(isProviderSettingsDraft({ providerId: 'ollama' }), true)
  assert.equal(isProviderSettingsDraft({ apiKey: 'k', params: { temperature: 0.2 } }), true)
  assert.equal(isProviderSettingsDraft({ providerId: 'openai' }), false)
  assert.equal(isProviderSettingsDraft({ params: { temperature: '热' } }), false)
  assert.equal(isProviderSettingsDraft(null), false)
})

test('isAgentRunRequest：goal 非空，confirmedStepIds 只能是字符串数组', () => {
  assert.equal(isAgentRunRequest({ id: UUID, goal: '做事' }), true)
  assert.equal(isAgentRunRequest({ id: UUID, goal: '做事', confirmedStepIds: ['1'] }), true)
  assert.equal(isAgentRunRequest({ id: UUID, goal: '   ' }), false)
  assert.equal(isAgentRunRequest({ id: UUID, goal: '做事', confirmedStepIds: [1] }), false)
  assert.equal(isAgentRunRequest({ id: 'x', goal: '做事' }), false)
})

test('isWorkspaceImportPath：只接受非空字符串', () => {
  assert.equal(isWorkspaceImportPath('D:/a/b.md'), true)
  assert.equal(isWorkspaceImportPath('   '), false)
  assert.equal(isWorkspaceImportPath(42), false)
  assert.equal(isWorkspaceImportPath(null), false)
})

test('isAssistantDraft：enabled 可选，但给了就必须是布尔', () => {
  assert.equal(isAssistantDraft({ name: 'x' }), true)
  assert.equal(isAssistantDraft({ name: 'x', enabled: true }), true)
  assert.equal(isAssistantDraft({ name: 'x', enabled: false }), true)
  assert.equal(isAssistantDraft({ name: 'x', enabled: 'no' }), false)
  assert.equal(isAssistantDraft({ name: 'x', enabled: 0 }), false)
})
