// 契约测试：Agent 小组的 CRUD、归属、排序筛选与状态聚合。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { AgentGroupDto, AssistantDto, ConversationDto } from '../../../../shared/types/ipc.ts'
import { DEFAULT_ASSISTANT_ID } from '../../../../shared/types/ipc.ts'
import {
  addAgentToGroup,
  agentGroupIds,
  computeGroupBenchStatus,
  createGroup,
  filterAgents,
  normalizeGroups,
  parseAgentGroups,
  pinBuiltinAgent,
  removeAgentFromGroup,
  removeGroup,
  renameGroup,
  setGroupLead,
  sortAgents,
  toggleGroupCollapsed,
  ungroupedAgents
} from '../agentGroups.ts'

const NOW = '2026-11-28T00:00:00.000Z'

function agent(id: string, over: Partial<AssistantDto> = {}): AssistantDto {
  return {
    id,
    name: id,
    systemPrompt: '',
    providerId: null,
    modelId: null,
    params: { temperature: 0.7, maxTokens: 1024, topP: 1 },
    createdAt: NOW,
    updatedAt: NOW,
    ...over
  }
}

function group(id: string, over: Partial<AgentGroupDto> = {}): AgentGroupDto {
  return {
    id,
    name: id,
    memberIds: [],
    leadAgentId: null,
    collapsed: false,
    updatedAt: NOW,
    ...over
  }
}

function conversation(id: string, assistantId: string | null, updatedAt = NOW): ConversationDto {
  return { id, title: id, assistantId, createdAt: NOW, updatedAt }
}

test('持久化解析：坏 JSON / 非数组回退空，重复 id 丢弃，组长的非法值被修正', () => {
  assert.deepEqual(parseAgentGroups(null), [])
  assert.deepEqual(parseAgentGroups('not json'), [])
  assert.deepEqual(parseAgentGroups('{}'), [])
  const restored = parseAgentGroups(
    JSON.stringify([
      { id: 'g1', name: 'A', memberIds: ['a1', 'a1', 3], leadAgentId: 'ghost' },
      { id: 'g1', name: 'dup' },
      { name: 'no id' }
    ])
  )
  assert.equal(restored.length, 1)
  assert.deepEqual(restored[0].memberIds, ['a1'])
  assert.equal(restored[0].leadAgentId, 'a1')
})

test('normalizeGroups：删掉的 Agent 从成员里剪掉，组长顺延', () => {
  const groups = [group('g1', { memberIds: ['a1', 'gone'], leadAgentId: 'gone' })]
  const next = normalizeGroups(groups, [agent('a1')])
  assert.deepEqual(next[0].memberIds, ['a1'])
  assert.equal(next[0].leadAgentId, 'a1')
})

test('建组 / 改名 / 删组 / 折叠', () => {
  const created = createGroup([], { id: 'g1', name: '  前端组  ', now: NOW, memberIds: ['a1'] })
  assert.equal(created[0].name, '前端组')
  assert.equal(created[0].leadAgentId, 'a1')

  const renamed = renameGroup(created, 'g1', '后端组', NOW)
  assert.equal(renamed[0].name, '后端组')
  // 空名字不生效
  assert.equal(renameGroup(renamed, 'g1', '   ', NOW), renamed)

  const collapsed = toggleGroupCollapsed(renamed, 'g1')
  assert.equal(collapsed[0].collapsed, true)
  assert.equal(toggleGroupCollapsed(collapsed, 'g1', false)[0].collapsed, false)

  assert.deepEqual(removeGroup(collapsed, 'g1'), [])
  assert.equal(removeGroup(collapsed, 'nope'), collapsed)
})

test('入组：multi 保留其它组席位，single 从旧组移出并顺延组长', () => {
  const groups = [
    group('g1', { memberIds: ['a1', 'a2'], leadAgentId: 'a1' }),
    group('g2', { memberIds: [] })
  ]
  const multi = addAgentToGroup(groups, 'a1', 'g2', 'multi', NOW)
  assert.deepEqual(multi[0].memberIds, ['a1', 'a2'])
  assert.deepEqual(multi[1].memberIds, ['a1'])
  assert.equal(multi[1].leadAgentId, 'a1')

  const single = addAgentToGroup(groups, 'a1', 'g2', 'single', NOW)
  assert.deepEqual(single[0].memberIds, ['a2'])
  assert.equal(single[0].leadAgentId, 'a2')
  assert.deepEqual(single[1].memberIds, ['a1'])
})

test('退组 / 指定组长：只动目标组，组长退组后顺延到下一位', () => {
  const groups = [group('g1', { memberIds: ['a1', 'a2'], leadAgentId: 'a1' })]
  const removed = removeAgentFromGroup(groups, 'a1', 'g1', NOW)
  assert.deepEqual(removed[0].memberIds, ['a2'])
  assert.equal(removed[0].leadAgentId, 'a2')

  const led = setGroupLead(groups, 'g1', 'a2', NOW)
  assert.equal(led[0].leadAgentId, 'a2')
  // 非成员不能当组长
  assert.equal(setGroupLead(groups, 'g1', 'a9', NOW)[0].leadAgentId, 'a1')
})

test('归属查询：多归属能查出多个组；未分组只含不在任何组里的 Agent', () => {
  const groups = [
    group('g1', { memberIds: ['a1', 'a2'] }),
    group('g2', { memberIds: ['a1'] })
  ]
  assert.deepEqual(agentGroupIds(groups, 'a1'), ['g1', 'g2'])
  assert.deepEqual(
    ungroupedAgents(groups, [agent('a1'), agent('a2'), agent('a3')]).map((item) => item.id),
    ['a3']
  )
})

test('搜索与排序：忽略大小写；手动保持原序，最近更新按 updatedAt 降序', () => {
  const list = [
    agent('a1', { name: 'Alpha', updatedAt: '2026-01-01T00:00:00.000Z' }),
    agent('a2', { name: 'beta', updatedAt: '2026-03-01T00:00:00.000Z' }),
    agent('a3', { name: 'Gamma', enabled: false, updatedAt: '2025-12-01T00:00:00.000Z' })
  ]
  assert.deepEqual(filterAgents(list, { keyword: 'ALP' }).map((a) => a.id), ['a1'])
  assert.deepEqual(filterAgents(list, { hideDisabled: true }).map((a) => a.id), ['a1', 'a2'])
  assert.deepEqual(sortAgents(list, 'manual').map((a) => a.id), ['a1', 'a2', 'a3'])
  assert.deepEqual(sortAgents(list, 'recent').map((a) => a.id), ['a2', 'a1', 'a3'])
})

test('组状态聚合：任一在跑即 working，全员停用才 disabled', () => {
  const assistants = [agent('a1'), agent('a2'), agent('a9', { enabled: false })]
  const sessions = [
    conversation('s1', 'a1'),
    conversation('s2', 'a2'),
    conversation('s3', 'a9')
  ]
  const g = group('g1', { memberIds: ['a1', 'a2'] })
  const idle = computeGroupBenchStatus(g, assistants, sessions, null)
  assert.equal(idle.state, 'idle')
  assert.equal(idle.memberCount, 2)

  const working = computeGroupBenchStatus(g, assistants, sessions, 's1')
  assert.equal(working.state, 'working')
  assert.equal(working.workingCount, 1)

  const disabled = computeGroupBenchStatus(
    group('g2', { memberIds: ['a9'] }),
    assistants,
    sessions,
    null
  )
  assert.equal(disabled.state, 'disabled')
  assert.equal(disabled.disabledCount, 1)
})

test('内置通用助手恒置顶：最近更新排序也挤不下去', () => {
  const assistants = [
    agent('a1', { updatedAt: '2026-03-01T00:00:00.000Z' }),
    agent(DEFAULT_ASSISTANT_ID, { builtin: true, updatedAt: '2026-01-01T00:00:00.000Z' }),
    agent('a2', { updatedAt: '2026-02-01T00:00:00.000Z' })
  ]
  const sorted = pinBuiltinAgent(
    [...assistants].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  )
  assert.equal(sorted[0].id, DEFAULT_ASSISTANT_ID)
  assert.deepEqual(
    sorted.slice(1).map((item) => item.id),
    ['a1', 'a2']
  )
})
