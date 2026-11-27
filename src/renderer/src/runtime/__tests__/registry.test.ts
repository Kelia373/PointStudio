// 契约测试：统一注册表的排序、覆盖回退、按插件卸载与故障隔离。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ComponentRegistry } from '../registry.ts'

test('registerSlot 按 order 升序，缺省 100', () => {
  const registry = new ComponentRegistry()
  registry.registerSlot('builtin', 'topbar.right', 'late', 200)
  registry.registerSlot('builtin', 'topbar.right', 'default')
  registry.registerSlot('builtin', 'topbar.right', 'early', 10)

  const order = registry.getSlot('topbar.right').map((entry) => entry.component)
  assert.deepEqual(order, ['early', 'default', 'late'])
})

test('overrideComponent 后注册者生效，dispose 后回退为 null', () => {
  const registry = new ComponentRegistry()
  const dispose = registry.overrideComponent('plugin-a', 'chat.bubble', 'A')

  assert.equal(registry.getOverride('chat.bubble')?.component, 'A')

  dispose()
  assert.equal(registry.getOverride('chat.bubble'), null)
})

test('disposePlugin 只清该插件，builtin 与其他插件不受影响', () => {
  const registry = new ComponentRegistry()
  registry.registerPage('plugin-a', { id: 'a.page', title: 'A', component: 'A' })
  registry.registerSlot('plugin-a', 'appbar.left', 'a-slot')
  registry.overrideComponent('plugin-a', 'chat.empty', 'a-empty')
  registry.registerPage('builtin', { id: 'chat', title: '会话', component: 'builtin' })
  registry.registerSlot('plugin-b', 'appbar.left', 'b-slot')

  registry.disposePlugin('plugin-a')

  assert.equal(registry.getPages().length, 1)
  assert.equal(registry.getPages()[0].def.id, 'chat')
  assert.equal(registry.getSlot('appbar.left').length, 1)
  assert.equal(registry.getSlot('appbar.left')[0].pluginId, 'plugin-b')
  assert.equal(registry.getOverride('chat.empty'), null)
})

test('同一插件 5 分钟内连报 3 次错会被隔离并剥离覆盖组件', () => {
  let clock = 0
  const registry = new ComponentRegistry({ now: () => clock })
  registry.overrideComponent('plugin-a', 'chat.bubble', 'A')

  registry.reportError('plugin-a', new Error('boom'))
  registry.reportError('plugin-a', new Error('boom'))
  assert.equal(registry.isQuarantined('plugin-a'), false)

  clock = 1_000
  registry.reportError('plugin-a', new Error('boom'))

  assert.equal(registry.isQuarantined('plugin-a'), true)
  assert.equal(registry.getOverride('chat.bubble'), null)
})
