// 契约测试：双轨模型服务、四槽位与 CLI 命令预览。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AUTO_ROUTE_MODEL } from '../modelOptions.ts'
import {
  buildCliInvocationPreview,
  collectAvailableModelOptions,
  createDefaultModelServicesState,
  modelDisplayLabel,
  parseModelServicesState,
  serializeModelServicesState
} from '../modelServices.ts'

test('默认状态：4 API / 6 CLI / 2 本地 + 四槽位 + 浏览器配置', () => {
  const state = createDefaultModelServicesState()
  assert.equal(state.api.length, 4)
  assert.equal(state.cli.length, 6)
  assert.equal(state.local.length, 2)
  assert.equal(state.slots.primaryModel, AUTO_ROUTE_MODEL)
  assert.equal(state.browser.driver, 'agent-browser-sandbox')
  assert.equal(state.browser.smartGateOnSubmit, true)
  assert.equal(state.cli.find((item) => item.preset === 'opencode')?.enabled, true)
})

test('持久化解析：坏数据回退默认，部分字段合并', () => {
  const defaults = createDefaultModelServicesState()
  assert.deepEqual(parseModelServicesState('not json'), defaults)
  assert.deepEqual(parseModelServicesState(null), defaults)

  const partial = parseModelServicesState(
    JSON.stringify({ slots: { primaryModel: 'deepseek-chat' } })
  )
  assert.equal(partial.slots.primaryModel, 'deepseek-chat')
  assert.equal(partial.slots.fastModel, defaults.slots.fastModel)
  assert.equal(partial.cli.length, 6)
})

test('CLI 预览：替换占位符并按权限模式拼标志，无多余空格', () => {
  const state = createDefaultModelServicesState()
  const opencode = state.cli.find((item) => item.preset === 'opencode')!

  const smart = buildCliInvocationPreview(opencode, {
    permissionMode: 'smart',
    workspace: 'D:/Project/PointStudio',
    model: 'deepseek-chat',
    prompt: '跑一下门禁'
  })
  assert.match(smart, /^opencode run --cwd D:\/Project\/PointStudio --model deepseek-chat "跑一下门禁"/)
  assert.match(smart, /--smart-approve$/)
  assert.doesNotMatch(smart, /\s{2,}/)

  const full = buildCliInvocationPreview(opencode, {
    permissionMode: 'full-access',
    workspace: 'D:/w',
    model: 'm',
    prompt: 'p'
  })
  assert.match(full, /--dangerously-skip-permissions$/)

  // 历史值 ask 归一到 smart
  const legacy = buildCliInvocationPreview(opencode, {
    permissionMode: 'ask' as never,
    workspace: 'w',
    prompt: 'p'
  })
  assert.match(legacy, /--smart-approve$/)
})

test('可用模型汇总：只收已启用项，CLI 用 cli: 前缀和中文标签', () => {
  const state = createDefaultModelServicesState()
  const values = collectAvailableModelOptions(state).map((item) => item.value)
  assert.ok(values.includes('deepseek-chat'))
  assert.ok(values.includes('cli:opencode'))
  assert.equal(values.includes('cli:paseo'), false, '默认未启用的引擎不该出现')

  const enabled = {
    ...state,
    cli: state.cli.map((item) =>
      item.preset === 'paseo' ? { ...item, enabled: true } : item
    ),
    local: state.local.map((item) =>
      item.id === 'ollama' ? { ...item, enabled: true } : item
    )
  }
  const options = collectAvailableModelOptions(enabled)
  assert.ok(options.some((item) => item.value === 'cli:paseo'))
  assert.ok(options.some((item) => item.value === 'llama3.1' && item.kind === 'local'))
  assert.equal(
    options.find((item) => item.value === 'cli:opencode')?.label,
    '⚡ OpenCode · CLI 引擎'
  )
})

test('显示名：CLI 用友好标签，未知值原样返回', () => {
  const state = createDefaultModelServicesState()
  assert.equal(modelDisplayLabel('cli:opencode', state), '⚡ OpenCode · CLI 引擎')
  assert.equal(modelDisplayLabel('unknown-model', state), 'unknown-model')
  assert.equal(modelDisplayLabel(AUTO_ROUTE_MODEL, state), '🐼 Auto · 协同路由')
})

test('序列化再解析保持状态', () => {
  const state = createDefaultModelServicesState()
  state.slots.embeddingModel = 'text-embedding-3-small'
  const restored = parseModelServicesState(serializeModelServicesState(state))
  assert.equal(restored.slots.embeddingModel, 'text-embedding-3-small')
})
