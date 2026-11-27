// 契约测试：私域记忆的候选提炼与唤醒匹配。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectMemoryCandidate, matchActiveMemories, type AgentMemoryItem } from '../memorySpark.ts'

function memory(over: Partial<AgentMemoryItem> & { id: string }): AgentMemoryItem {
  return {
    agentId: 'a1',
    scope: 'global',
    text: '默认记忆',
    sourceSessionId: 's1',
    locked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over
  } as AgentMemoryItem
}

test('用户消息带「以后/记住」等规则信号时提炼出候选记忆', () => {
  const candidate = detectMemoryCandidate('以后回复都先给结论，再展开细节', '好的，记住了。')
  assert.ok(candidate)
  assert.equal(candidate?.defaultScope, 'global')
  assert.ok((candidate?.suggestedText.length ?? 0) <= 80)
  assert.ok(candidate?.suggestedText.includes('以后'))
})

test('提到「本项目」时候选记忆默认落在项目作用域', () => {
  const candidate = detectMemoryCandidate('这个项目的接口一律用 snake_case', '')
  assert.equal(candidate?.defaultScope, 'project')
})

test('没有任何规则信号时不产生候选', () => {
  assert.equal(detectMemoryCandidate('今天天气怎么样', '晴，26 度。'), null)
})

test('超长文本被截断到 80 字以内', () => {
  const long = `记住：${'很长的规则'.repeat(40)}`
  const candidate = detectMemoryCandidate(long, '')
  assert.ok((candidate?.suggestedText.length ?? 0) <= 80)
})

test('唤醒时只取当前 Agent 且作用域匹配的记忆，最多 3 条', () => {
  // 故意把不匹配的排在最前：若过滤失效，slice(0,3) 会先把它们吐出来。
  const memories: AgentMemoryItem[] = [
    memory({ id: 'other-agent', agentId: 'a2', text: '别人的' }),
    memory({ id: 'other-project', scope: 'project:w9', text: '别的项目' }),
    memory({ id: 'm1', text: '一' }),
    memory({ id: 'm2', text: '二' }),
    memory({ id: 'm3', text: '三' }),
    memory({ id: 'm4', text: '四' })
  ]

  const active = matchActiveMemories(memories, 'a1', 'w1', '随便问')
  assert.equal(active.length, 3)
  assert.deepEqual(active.map((item) => item.id), ['m1', 'm2', 'm3'])
})

test('属于当前项目的记忆会被唤醒', () => {
  const memories = [memory({ id: 'mine', scope: 'project:w1', text: '本项目约定' })]
  const active = matchActiveMemories(memories, 'a1', 'w1', '')
  assert.deepEqual(active.map((item) => item.id), ['mine'])
})

test('没有绑定 Agent 时不唤醒任何记忆', () => {
  const memories = [memory({ id: 'm1' })]
  assert.deepEqual(matchActiveMemories(memories, null, 'w1', ''), [])
})
