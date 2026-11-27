// 契约测试：6 级设置导航的元数据、回退与搜索。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_SETTINGS_SECTION,
  SETTINGS_GROUPS,
  filterSettingsGroups,
  findSettingsSection
} from '../settingsNav.ts'

test('严格 6 个一级分组，order 1..6 且顺序稳定', () => {
  assert.equal(SETTINGS_GROUPS.length, 6)
  assert.deepEqual(
    SETTINGS_GROUPS.map((group) => group.order),
    [1, 2, 3, 4, 5, 6]
  )
  assert.deepEqual(
    SETTINGS_GROUPS.map((group) => group.id),
    ['ai-agent', 'basic', 'workflow', 'interface', 'experimental', 'privacy-security']
  )
})

test('基本设置里不再有重复的「显示」；外观归界面、备份归隐私', () => {
  const basic = SETTINGS_GROUPS.find((group) => group.id === 'basic')!
  assert.equal(basic.sections.some((item) => item.label === '显示'), false)

  const interfaceGroup = SETTINGS_GROUPS.find((group) => group.id === 'interface')!
  assert.ok(interfaceGroup.sections.some((item) => item.id === 'appearance'))

  const privacy = SETTINGS_GROUPS.find((group) => group.id === 'privacy-security')!
  assert.ok(privacy.sections.some((item) => item.id === 'data-backup'))
})

test('findSettingsSection：非法 ID 回退到默认模块', () => {
  assert.equal(findSettingsSection('mcp').label, 'MCP')
  const fallback = findSettingsSection('not-a-section')
  assert.equal(fallback.id, DEFAULT_SETTINGS_SECTION)
  assert.equal(findSettingsSection(null).id, DEFAULT_SETTINGS_SECTION)
})

test('搜索：空关键字返回完整 6 组', () => {
  assert.equal(filterSettingsGroups('').length, 6)
  assert.equal(filterSettingsGroups('   ').length, 6)
})

test('搜索：按二级名称/描述过滤，命中分组名时保留整组', () => {
  const model = filterSettingsGroups('模型服务')
  assert.equal(model.length, 1)
  assert.deepEqual(
    model[0].sections.map((item) => item.id),
    ['model-services']
  )

  const browser = filterSettingsGroups('浏览器')
  assert.equal(browser.length, 1)
  assert.deepEqual(
    browser[0].sections.map((item) => item.id),
    ['browser']
  )

  const groupHit = filterSettingsGroups('隐私和安全')
  assert.equal(groupHit.length, 1)
  assert.equal(groupHit[0].sections.length, 3)
})

test('搜索：无结果返回空数组，不伪造占位', () => {
  assert.deepEqual(filterSettingsGroups('绝对不存在的设置'), [])
})
