// 契约测试：主舞台左右分屏的状态机。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import type { ConversationDto } from '../../../../shared/types/ipc.ts'
import {
  SPLIT_DEFAULT_RATIO,
  SPLIT_MAX_RATIO,
  SPLIT_MIN_RATIO,
  clampSplitRatio,
  createSplitState,
  parseSplitState,
  reconcileSplitSession,
  setSecondaryTarget,
  setSplitRatio,
  toggleSplitPane
} from '../splitView.ts'

function conversation(id: string): ConversationDto {
  return {
    id,
    title: id,
    assistantId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}

test('缺省是关闭、左右各半、副画布指向会话', () => {
  const state = createSplitState()
  assert.equal(state.enabled, false)
  assert.equal(state.kind, 'session')
  assert.equal(state.ratio, SPLIT_DEFAULT_RATIO)
  assert.equal(state.sessionId, null)
})

test('开关分屏：不带参数是切换，带参数是设为', () => {
  const opened = toggleSplitPane(createSplitState())
  assert.equal(opened.enabled, true)
  assert.equal(toggleSplitPane(opened).enabled, false)
  assert.equal(toggleSplitPane(createSplitState(), true).enabled, true)
  // 已经是目标态时返回原对象，不制造无谓重渲染
  assert.equal(toggleSplitPane(opened, true), opened)
})

test('比例钳制在 [0.25, 0.75]，非法值回落到默认', () => {
  assert.equal(clampSplitRatio(0.1), SPLIT_MIN_RATIO)
  assert.equal(clampSplitRatio(0.9), SPLIT_MAX_RATIO)
  assert.equal(clampSplitRatio(Number.NaN), SPLIT_DEFAULT_RATIO)
  const state = setSplitRatio(createSplitState(), 0.62)
  assert.equal(state.ratio, 0.62)
  assert.equal(setSplitRatio(state, 0.01).ratio, SPLIT_MIN_RATIO)
})

test('切换副画布目标：形态 / 会话 / 功能页各自生效', () => {
  const base = createSplitState()
  const toPage = setSecondaryTarget(base, { kind: 'page', pageId: 'prompts' })
  assert.equal(toPage.kind, 'page')
  assert.equal(toPage.pageId, 'prompts')
  const toSession = setSecondaryTarget(toPage, { kind: 'session', sessionId: 's9' })
  assert.equal(toSession.kind, 'session')
  assert.equal(toSession.sessionId, 's9')
  const toTrace = setSecondaryTarget(toSession, { kind: 'trace', traceMissionId: 'm9' })
  assert.equal(toTrace.kind, 'trace')
  assert.equal(toTrace.traceMissionId, 'm9')
  // 没变化就复用原对象
  assert.equal(setSecondaryTarget(toSession, { kind: 'session' }), toSession)
})

test('会话被删除时回退到另一条，优先避开主窗格', () => {
  const sessions = [conversation('s1'), conversation('s2'), conversation('s3')]
  const state = { ...createSplitState(), sessionId: 'gone' }
  const next = reconcileSplitSession(state, sessions, 's1')
  assert.equal(next.sessionId, 's2')
  // 已经是有效会话则原样返回
  assert.equal(reconcileSplitSession(next, sessions, 's1'), next)
  // 用户主动选的空保持为空，不在刷新时偷偷回填
  const empty = { ...createSplitState(), sessionId: null }
  assert.equal(reconcileSplitSession(empty, sessions, 's1'), empty)
  // 只剩主会话时退而求其次
  assert.equal(reconcileSplitSession(state, [conversation('s1')], 's1').sessionId, 's1')
  // 一条会话都没有就置空
  assert.equal(reconcileSplitSession(state, [], null).sessionId, null)
})

test('非会话形态不因会话列表变化被改写', () => {
  const state = { ...createSplitState(), kind: 'markdown' as const, sessionId: 'gone' }
  assert.equal(reconcileSplitSession(state, [conversation('s1')], 's1'), state)
})

test('持久化恢复：坏数据回落默认，越界比例被钳制', () => {
  assert.equal(parseSplitState(null).enabled, false)
  assert.equal(parseSplitState('not json').enabled, false)
  const restored = parseSplitState(
    JSON.stringify({ enabled: true, kind: 'page', pageId: 'prompts', ratio: 9 })
  )
  assert.equal(restored.enabled, true)
  assert.equal(restored.kind, 'page')
  assert.equal(restored.pageId, 'prompts')
  assert.equal(restored.ratio, SPLIT_MAX_RATIO)
  // 未知形态不接受
  assert.equal(parseSplitState(JSON.stringify({ kind: 'video' })).kind, 'session')
})
