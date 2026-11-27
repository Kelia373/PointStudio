// 契约测试：Agent 头像的确定性选择与兜底几何头像。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  AVATAR_KEYS,
  hashString,
  pickAgentAvatar,
  seededAvatarSvg
} from '../agentAvatar.ts'

test('角色关键词命中：架构 / 测试 / 依赖 / 素材 / 狐狸', () => {
  assert.equal(pickAgentAvatar('a1', '架构Bot'), 'triangular-ruler')
  assert.equal(pickAgentAvatar('a2', '测试Bot'), 'test-tube')
  assert.equal(pickAgentAvatar('a3', '依赖更新'), 'package')
  assert.equal(pickAgentAvatar('a4', '素材猎手'), 'magnifier')
  assert.equal(pickAgentAvatar('a5', '狐狸小助手'), 'fox')
})

test('「xxBot」不会被泛词 bot 抢走具体角色', () => {
  // 中文关键词先命中，'bot' 只兜底
  assert.equal(pickAgentAvatar('x', '开发Bot'), 'hammer-wrench')
  assert.equal(pickAgentAvatar('x', '测试Bot'), 'test-tube')
  assert.equal(pickAgentAvatar('x', '小助手Bot'), 'robot')
})

test('没有关键词时按 id 哈希，稳定且落在池子里', () => {
  const first = pickAgentAvatar('agent-42', '无名氏')
  assert.equal(pickAgentAvatar('agent-42', '无名氏'), first)
  assert.ok(AVATAR_KEYS.includes(first))
})

test('不同 id 能分散到多张，不会永远同一张', () => {
  const used = new Set<string>()
  for (let index = 0; index < 120; index += 1) {
    used.add(pickAgentAvatar(`agent-${index}`, '无名氏'))
  }
  assert.ok(used.size >= 8, `只用到 ${used.size} 张，哈希分布太差`)
})

test('FNV-1a 稳定且在 32 位无符号范围内', () => {
  assert.equal(hashString('abc'), hashString('abc'))
  assert.notEqual(hashString('abc'), hashString('abd'))
  const value = hashString('架构Bot')
  assert.ok(Number.isInteger(value) && value >= 0 && value <= 0xffffffff)
})

test('兜底 SVG：确定性、用 currentColor、没有任何脚本', () => {
  const one = seededAvatarSvg('agent-1')
  assert.equal(one, seededAvatarSvg('agent-1'))
  assert.match(one, /^<svg/)
  assert.match(one, /currentColor/)
  assert.doesNotMatch(one, /<script/i)
  assert.notEqual(one, seededAvatarSvg('agent-2'))
  // 不能是空头像
  assert.match(one, /<rect/)
})
