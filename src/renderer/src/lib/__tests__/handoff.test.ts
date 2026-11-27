// 契约测试：换 Agent 接力时生成真实交接记录。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildHandoffEnvelope } from '../handoff.ts'
import type { UiMessage } from '../chatState.ts'

function msg(role: 'user' | 'assistant', content: string): UiMessage {
  return { id: `${role}-${content.length}`, role, content, status: 'complete' }
}

test('从 Agent 换到 Agent：字段完整、摘要可读', () => {
  const handoff = buildHandoffEnvelope({
    handoffId: 'h1',
    missionId: 's1',
    previous: { id: 'a1', name: '架构Bot' },
    next: { id: 'a2', name: '测试Bot' },
    messages: [msg('assistant', '施工单已定稿，四条改动都通过门禁。')]
  })
  assert.equal(handoff.fromAgentId, 'a1')
  assert.equal(handoff.toAgentId, 'a2')
  assert.equal(handoff.kind, 'handoff')
  assert.equal(handoff.status, 'accepted')
  assert.equal(handoff.missionId, 's1')
  assert.match(handoff.summary, /测试Bot/)
  assert.match(handoff.payloadMarkdown, /施工单已定稿/)
})

test('原先没有 Agent：from 记为 owner，不编一个假 Agent', () => {
  const handoff = buildHandoffEnvelope({
    handoffId: 'h2',
    missionId: 's1',
    previous: null,
    next: { id: 'a2', name: '开发Bot' },
    messages: []
  })
  assert.equal(handoff.fromAgentId, 'owner')
  assert.match(handoff.payloadMarkdown, /还没有可交接的结论/)
})

test('交接正文取最后一条助手结论，并截断超长内容', () => {
  const long = '结'.repeat(600)
  const handoff = buildHandoffEnvelope({
    handoffId: 'h3',
    missionId: 's1',
    previous: { id: 'a1', name: '架构Bot' },
    next: { id: 'a2', name: '测试Bot' },
    messages: [msg('assistant', '较早的结论'), msg('user', '继续'), msg('assistant', long)]
  })
  assert.match(handoff.payloadMarkdown, /…/)
  assert.doesNotMatch(handoff.payloadMarkdown, /较早的结论/)
})
