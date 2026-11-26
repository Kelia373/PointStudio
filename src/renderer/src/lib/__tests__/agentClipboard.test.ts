// 契约测试：Agent 的复制 / 粘贴。
//
// 「复制」只把配置放进应用内剪贴板，「粘贴」才创建；粘贴后自动进入重命名，
// 并且名字不能和现有 Agent 重名。这三条都属于纯逻辑，先钉住再谈界面。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  copyAgentName,
  isAgentNameTaken,
  parseAgentClip,
  serializeAgentClip,
  uniqueAgentName
} from '../agentClipboard.ts'

const AGENT = {
  name: '代码审查员',
  systemPrompt: '你是严格的代码审查员',
  providerId: 'deepseek',
  modelId: 'deepseek-chat',
  params: { temperature: 0.2, maxTokens: 4096, topP: 1 }
}

test('复制 → 解析 roundtrip，配置一字不差', () => {
  assert.deepEqual(parseAgentClip(serializeAgentClip(AGENT)), AGENT)
})

test('剪贴板里是坏数据时返回 null，不把半个 Agent 粘出来', () => {
  assert.equal(parseAgentClip(null), null)
  assert.equal(parseAgentClip(''), null)
  assert.equal(parseAgentClip('不是 JSON'), null)
  assert.equal(parseAgentClip('{"systemPrompt":"x"}'), null)
  assert.equal(parseAgentClip('{"name":"   "}'), null)
})

test('缺省字段按默认补齐：旧剪贴板没有 params 也能粘', () => {
  const parsed = parseAgentClip('{"name":"旧副本"}')
  assert.ok(parsed)
  assert.equal(parsed.systemPrompt, '')
  assert.equal(parsed.providerId, null)
  assert.equal(parsed.params.temperature, 0.7)
})

test('粘贴出来的名字是「xx 副本」', () => {
  assert.equal(copyAgentName('代码审查员'), '代码审查员 副本')
  assert.equal(copyAgentName('  代码审查员  '), '代码审查员 副本')
  assert.equal(copyAgentName(''), '副本')
})

test('副本重名时自动加序号，不会出现两个同名 Agent', () => {
  assert.equal(uniqueAgentName('代码审查员 副本', []), '代码审查员 副本')
  assert.equal(uniqueAgentName('代码审查员 副本', ['代码审查员 副本']), '代码审查员 副本 2')
  assert.equal(
    uniqueAgentName('代码审查员 副本', ['代码审查员 副本', '代码审查员 副本 2']),
    '代码审查员 副本 3'
  )
})

test('重名校验忽略首尾空格与大小写', () => {
  assert.equal(isAgentNameTaken(' CodeReviewer ', ['codereviewer']), true)
  assert.equal(isAgentNameTaken('代码审查员', ['代码审查员']), true)
  assert.equal(isAgentNameTaken('新的名字', ['代码审查员']), false)
  // 空名字交给后端报 E_NAME_REQUIRED，这里不算重名
  assert.equal(isAgentNameTaken('   ', ['代码审查员']), false)
})
