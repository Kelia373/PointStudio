// 契约测试：过程/结论双轨切分、按天分组、镜头切换。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  groupTimelineByDay,
  shouldCollapse,
  splitProcessAndConclusion,
  toggleLens,
  type TimelineEntry
} from '../timelineLens.ts'

test('有「结论：」标记时，标记前算过程、标记后算结论', () => {
  const split = splitProcessAndConclusion('先看代码\n再看测试\n结论：这是个类型问题')
  assert.deepEqual(split.process, ['先看代码', '再看测试'])
  assert.equal(split.conclusion, '这是个类型问题')
})

test('没有标记时，最后一段作为结论，其余段落进过程轨', () => {
  const split = splitProcessAndConclusion('第一段分析\n\n第二段推理\n\n所以应该改缓存')
  assert.equal(split.conclusion, '所以应该改缓存')
  assert.deepEqual(split.process, ['第一段分析', '第二段推理'])
})

test('单段文本没有过程轨，整段就是结论', () => {
  const split = splitProcessAndConclusion('直接给答案：改这里就行')
  assert.deepEqual(split.process, [])
  assert.equal(split.conclusion, '直接给答案：改这里就行')
})

test('空文本不崩', () => {
  const split = splitProcessAndConclusion('   ')
  assert.deepEqual(split.process, [])
  assert.equal(split.conclusion, '')
})

test('只有够长且真的有过程轨时才折叠', () => {
  const long = `${'过程描述'.repeat(80)}\n\n结论：改缓存`
  assert.equal(shouldCollapse(splitProcessAndConclusion(long), long), true)
  assert.equal(shouldCollapse(splitProcessAndConclusion('结论：短'), '结论：短'), false)
})

test('时间线按天分组，新的一天排在前面', () => {
  const entries: TimelineEntry[] = [
    { id: 'a', title: '前天', at: '2026-01-01T10:00:00.000Z' },
    { id: 'b', title: '昨天', at: '2026-01-02T09:00:00.000Z' },
    { id: 'c', title: '昨天晚些', at: '2026-01-02T18:00:00.000Z' }
  ]
  const groups = groupTimelineByDay(entries)
  assert.deepEqual(groups.map((g) => g.day), ['2026-01-02', '2026-01-01'])
  assert.deepEqual(groups[0].items.map((i) => i.id), ['c', 'b'])
})

test('镜头切换在结论与过程之间来回，且不污染其他消息', () => {
  const first = toggleLens({}, 'm1')
  assert.equal(first['m1'], 'process')
  const second = toggleLens(first, 'm1')
  assert.equal(second['m1'], 'conclusion')
  const third = toggleLens(second, 'm2')
  assert.equal(third['m2'], 'process')
  assert.equal(third['m1'], 'conclusion')
})
