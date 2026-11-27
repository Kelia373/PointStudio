// 契约测试：任务链聚合与「只看这一件事」过滤。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { AgentWorkerRunDto, HandoffEnvelopeDto } from '../../../../shared/types/ipc.ts'
import type { UiMessage } from '../chatState.ts'
import { buildMissionChains, filterMessagesByMission } from '../missionTrace.ts'

function handoff(missionId: string, from: string, to: string, summary: string): HandoffEnvelopeDto {
  return {
    handoffId: `h-${missionId}-${to}`,
    missionId,
    fromAgentId: from,
    toAgentId: to,
    kind: 'handoff',
    summary,
    payloadMarkdown: `# ${summary}`,
    status: 'running'
  }
}

function message(id: string, missionId: string | null, summary = ''): UiMessage {
  return {
    id,
    role: 'assistant',
    content: summary,
    status: 'complete',
    missionId,
    ...(missionId && summary
      ? { handoff: handoff(missionId, 'owner', 'a1', summary) }
      : {})
  }
}

function run(
  over: Partial<AgentWorkerRunDto> & { runId: string; missionId: string }
): AgentWorkerRunDto {
  return {
    agentId: 'a1',
    subagentRole: null,
    dispatchedBy: 'owner',
    taskTitle: '任务',
    sessionId: 's1',
    status: 'working',
    startedAt: '2026-01-01T00:00:00.000Z',
    ...over
  }
}

test('按 missionId 归拢两条链，标题取交接摘要，参与者按出现顺序', () => {
  const messages = [
    message('m1', 'mission-1', '找素材'),
    message('m2', 'mission-2', '做 UI'),
    message('m3', 'mission-1', '找素材（续）')
  ]
  const chains = buildMissionChains(messages, [])
  assert.equal(chains.length, 2)
  assert.equal(chains[0].title, '找素材')
  assert.equal(chains[0].messageCount, 2)
  assert.equal(chains[1].title, '做 UI')
  assert.deepEqual(chains[0].participants, ['owner', 'a1'])
  // 没有 Run 时视为已完成，不留一个永远转的圈
  assert.equal(chains[0].status, 'completed')
  assert.equal(chains[0].activeRunCount, 0)
})

test('普通对话（无 missionId）不进任何链，也不会造出空链', () => {
  const chains = buildMissionChains([message('x', null, '随手问一句')], [])
  assert.equal(chains.length, 0)
})

test('状态按优先级聚合：error 压过 waiting，waiting 压过 working', () => {
  const runs = [
    run({ runId: 'r1', missionId: 'm', status: 'working' }),
    run({ runId: 'r2', missionId: 'm', status: 'waiting' })
  ]
  assert.equal(buildMissionChains([], runs)[0].status, 'waiting')
  runs.push(run({ runId: 'r3', missionId: 'm', status: 'error' }))
  assert.equal(buildMissionChains([], runs)[0].status, 'error')
})

test('Run 只挂在跑的那条链上：别串到别人的 mission', () => {
  const runs = [
    run({ runId: 'r1', missionId: 'm1', status: 'working' }),
    run({ runId: 'r2', missionId: 'm2', status: 'completed' })
  ]
  const chains = buildMissionChains([message('a', 'm1', '一'), message('b', 'm2', '二')], runs)
  assert.equal(chains[0].activeRunCount, 1)
  assert.equal(chains[1].activeRunCount, 0)
  assert.equal(chains[1].status, 'completed')
})

test('进度与 Subagent 都算在活跃 Run 里', () => {
  const runs = [
    run({
      runId: 'r1',
      missionId: 'm',
      subagentRole: '素材搜集 Subagent',
      progress: { current: 2, total: 4, stepLabel: '检索' }
    })
  ]
  const chain = buildMissionChains([], runs)[0]
  assert.equal(chain.activeRunCount, 1)
  assert.deepEqual(chain.progress, { current: 2, total: 4, stepLabel: '检索' })
})

test('任务链过滤：null 原样返回，指定 mission 只留该链', () => {
  const messages = [message('a', 'm1', '一'), message('b', 'm2', '二'), message('c', null)]
  const all = filterMessagesByMission(messages, null)
  assert.equal(all, messages)
  assert.deepEqual(
    filterMessagesByMission(messages, 'm1').map((item) => item.id),
    ['a']
  )
  assert.deepEqual(filterMessagesByMission(messages, 'm9'), [])
})
