// 契约测试：Agent 右键菜单的六项动作。
//
// 菜单项与文案属于「界面契约」，写死在组件里就只能靠肉眼点；
// 摊成纯数据后可以钉住顺序、可点击性与会随状态变化的文案。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildAgentMenuItems } from '../agentMenu.ts'

test('六项动作，顺序固定：改名 → 设置 → 复制 → 粘贴 → 停用 → 删除', () => {
  const items = buildAgentMenuItems({ enabled: true, canPaste: true })
  assert.deepEqual(
    items.map((item) => item.action),
    ['rename', 'settings', 'copy', 'paste', 'toggle-enabled', 'remove']
  )
  assert.deepEqual(
    items.map((item) => item.label),
    ['重命名', '智能体设置', '复制智能体', '粘贴智能体', '标记为停用', '删除智能体']
  )
})

test('停用中的 Agent 菜单里给的是「标记为启用」', () => {
  const items = buildAgentMenuItems({ enabled: false, canPaste: true })
  const toggle = items.find((item) => item.action === 'toggle-enabled')
  assert.equal(toggle?.label, '标记为启用')
})

test('剪贴板为空时「粘贴智能体」置灰，而不是消失', () => {
  const items = buildAgentMenuItems({ enabled: true, canPaste: false })
  const paste = items.find((item) => item.action === 'paste')
  assert.equal(paste?.disabled, true)
  // 置灰不是删除：位置与文案都要还在，用户才知道有这个能力
  assert.equal(items.length, 6)
})
