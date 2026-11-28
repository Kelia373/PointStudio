// 契约测试：输入栏斜杠指令解析（裸 /plan 不得发起规划）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseSlashCommand, resolveComposerAction } from '../composerCommands.ts'

test('/plan 带目标才进入规划', () => {
  assert.deepEqual(parseSlashCommand('/plan 修复登录'), {
    kind: 'plan',
    goal: '修复登录'
  })
  assert.deepEqual(parseSlashCommand('/plan 多行\n目标'), {
    kind: 'plan',
    goal: '多行\n目标'
  })
})

test('裸 /plan 只提示补目标，不发起调用', () => {
  assert.deepEqual(parseSlashCommand('/plan'), { kind: 'plan-needs-goal' })
  assert.deepEqual(parseSlashCommand('/plan   '), { kind: 'plan-needs-goal' })
})

test('/stop 与 /clear 识别；普通文本与路径不误判', () => {
  assert.deepEqual(parseSlashCommand('/stop'), { kind: 'stop' })
  assert.deepEqual(parseSlashCommand('/clear'), { kind: 'clear' })
  assert.equal(parseSlashCommand('/usr/bin'), null)
  assert.equal(parseSlashCommand('帮我 /plan 一下'), null)
  assert.equal(parseSlashCommand('/planA 目标'), null)
})

test('resolveComposerAction：/stop 与 /clear 在 busy 下仍可用', () => {
  assert.deepEqual(resolveComposerAction('/stop', true), { type: 'stop' })
  assert.deepEqual(resolveComposerAction('/stop', false), { type: 'stop' })
  assert.deepEqual(resolveComposerAction('/clear', true), { type: 'clear' })
  assert.deepEqual(resolveComposerAction('/plan 修复登录', true), { type: 'blocked' })
  assert.deepEqual(resolveComposerAction('/plan 修复登录', false), {
    type: 'plan',
    goal: '修复登录'
  })
  assert.deepEqual(resolveComposerAction('/plan', true), { type: 'plan-needs-goal' })
  assert.deepEqual(resolveComposerAction('普通消息', true), { type: 'blocked' })
  assert.deepEqual(resolveComposerAction('普通消息', false), { type: 'send' })
})
