// 契约测试：双轨模型服务、四槽位与 CLI 命令预览。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { AUTO_ROUTE_MODEL } from '../modelOptions.ts'
import {
  addCustomApiProvider,
  buildCliInvocationPreview,
  collectAvailableModelOptions,
  collectModelPositionOptions,
  createCustomApiProvider,
  createDefaultModelServicesState,
  modelDisplayLabel,
  parseModelServicesState,
  providerDisplayName,
  removeCustomApiProvider,
  serializeModelServicesState
} from '../modelServices.ts'

test('默认状态：14 API / 13 CLI / 3 本地 + 四槽位 + 浏览器配置', () => {
  const state = createDefaultModelServicesState()
  assert.equal(state.api.length, 14)
  assert.equal(state.cli.length, 13)
  assert.equal(state.local.length, 3)
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
  assert.equal(partial.cli.length, 13)
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
  // model 为空时 --model 应整段剔除，prompt 不能顶到模型位
  assert.doesNotMatch(legacy, /--model/)
  assert.match(legacy, /"p"/)
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

test('模型位口径：只列主进程当前 provider，CLI 与其他家一律不进下拉', () => {
  const state = createDefaultModelServicesState()
  const deepseek = collectModelPositionOptions(state, 'deepseek')
  const values = deepseek.map((item) => item.value)
  assert.ok(values.includes('deepseek-chat'))
  assert.equal(values.includes('cli:opencode'), false)
  assert.equal(deepseek.some((item) => item.kind === 'cli'), false)
  // 目录里其他家的模型不能出现，否则会把别家模型名发到 DeepSeek 的地址上
  assert.equal(values.includes('llama3.1'), false)
  assert.equal(values.includes('gpt-5.1'), false)
  assert.equal(values.includes('kimi-k2.5'), false)
})

test('模型位口径：切到本地运行时只列该运行时的模型；未读到 provider 时为空', () => {
  const state = createDefaultModelServicesState()
  const ollama = collectModelPositionOptions(state, 'ollama').map((item) => item.value)
  assert.deepEqual(ollama, ['llama3.1', 'qwen2.5'])
  assert.equal(collectModelPositionOptions(state, 'lm-studio').length, 1)
  assert.equal(collectModelPositionOptions(state, null).length, 0)
  assert.equal(collectModelPositionOptions(state, 'not-configured').length, 0)
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

test('坏条目逐条清洗：null / 缺字段不进状态，槽位与浏览器字段类型错误回退', () => {
  const defaults = createDefaultModelServicesState()
  const dirty = parseModelServicesState(
    JSON.stringify({
      api: [null, { id: 'x' }, { id: 'y', name: 'Y', models: [1, 'm'] }],
      cli: [{ id: 'c', name: 'C', permissionFlags: null }],
      local: [{ id: 'bad' }],
      slots: { primaryModel: 123 },
      browser: { cdpPort: 'x' }
    })
  )
  // 脏条目被过滤，其余按 id 合并进完整目录；不在预置里的自定义项追加到末尾
  const customApi = dirty.api.find((item) => item.id === 'y')
  assert.deepEqual(customApi?.models, ['m'])
  assert.equal(dirty.api.length, defaults.api.length + 1)
  const customCli = dirty.cli.find((item) => item.id === 'c')
  assert.equal(customCli?.cwdPolicy, 'workspace')
  assert.equal(customCli?.preset, 'custom-command')
  assert.equal(dirty.cli.length, defaults.cli.length + 1)
  // 本地数组全是脏条目时整体回退默认，不让设置页白屏
  assert.equal(dirty.local.length, defaults.local.length)
  assert.equal(
    parseModelServicesState(JSON.stringify({ local: [{ id: 'bad' }] })).local.length,
    defaults.local.length
  )
  assert.equal(dirty.slots.primaryModel, defaults.slots.primaryModel)
  assert.equal(dirty.browser.cdpPort, defaults.browser.cdpPort)
})

test('完整厂商目录：14 API / 13 CLI / 3 本地，CLI 带 launchMode', () => {
  const catalog = createDefaultModelServicesState()
  assert.equal(catalog.api.length, 14)
  assert.equal(catalog.cli.length, 13)
  assert.equal(catalog.local.length, 3)
  assert.ok(catalog.api.some((item) => item.id === 'opencode-go'))
  assert.ok(catalog.cli.some((item) => item.id === 'cursor'))
  assert.ok(catalog.local.some((item) => item.id === 'vllm'))
  assert.equal(catalog.cli.every((item) => item.launchMode === 'cli' || item.launchMode === 'chat'), true)
})

test('老缓存增量合并：保留用户改动，同时补齐新预置厂商', () => {
  const legacy = JSON.stringify({
    api: [
      {
        id: 'deepseek',
        kind: 'api',
        name: 'DeepSeek',
        protocol: 'deepseek',
        enabled: false,
        baseUrl: 'https://my-proxy.example/v1',
        models: ['my-model'],
        defaultModel: 'my-model'
      }
    ],
    cli: [
      {
        id: 'opencode',
        kind: 'cli',
        preset: 'opencode',
        name: 'OpenCode',
        enabled: false,
        executable: 'opencode',
        transport: 'stdio-jsonl',
        argsTemplate: '{{prompt}}',
        permissionFlags: { 'auto-edit': '', smart: '', 'full-access': '' },
        cwdPolicy: 'workspace'
      }
    ],
    local: [
      {
        id: 'ollama',
        kind: 'local',
        name: 'Ollama',
        enabled: true,
        baseUrl: 'http://127.0.0.1:11434',
        models: ['qwen2.5'],
        numCtx: 4096,
        keepAliveMinutes: 30
      }
    ]
  })
  const merged = parseModelServicesState(legacy)
  assert.equal(merged.api.length, 14)
  assert.equal(merged.cli.length, 13)
  assert.equal(merged.local.length, 3)
  assert.equal(merged.api.find((item) => item.id === 'deepseek')?.baseUrl, 'https://my-proxy.example/v1')
  assert.equal(merged.api.find((item) => item.id === 'openai')?.name, 'OpenAI')
  assert.equal(merged.cli.find((item) => item.id === 'opencode')?.enabled, false)
  assert.equal(merged.local.find((item) => item.id === 'ollama')?.numCtx, 4096)
  assert.equal(merged.cli.find((item) => item.id === 'opencode')?.launchMode, 'cli')
})

test('自定义 API 服务商：创建、去重添加、只删自定义', () => {
  const base = createDefaultModelServicesState()
  const provider = createCustomApiProvider({ name: 'My Gateway', baseUrl: 'https://gw/v1', model: 'm1' })
  assert.equal(provider.id, 'custom-my-gateway')
  assert.equal(provider.protocol, 'openai-compatible')
  assert.deepEqual(provider.models, ['m1'])

  const added = addCustomApiProvider(base, { name: 'My Gateway', baseUrl: 'https://gw/v1' })
  assert.equal(added.api.length, 15)
  const again = addCustomApiProvider(added, { name: 'My Gateway', baseUrl: 'https://gw/v1' })
  assert.equal(again.api.length, 16)
  assert.equal(new Set(again.api.map((item) => item.id)).size, 16)

  const removed = removeCustomApiProvider(again, 'custom-my-gateway')
  assert.equal(removed.api.length, 15)
  // 内置项不可删
  assert.equal(removeCustomApiProvider(removed, 'deepseek').api.length, 15)
})

test('缓存结果被冻结：原地修改直接抛错，不会污染同一份 raw 的其他读者', () => {
  const raw = JSON.stringify({ slots: { primaryModel: 'deepseek-chat' } })
  const first = parseModelServicesState(raw)
  assert.equal(first.api[0].enabled, true)
  assert.throws(() => {
    first.api[0].enabled = false
  })
  assert.throws(() => {
    first.api.push(first.api[0])
  })
  const second = parseModelServicesState(raw)
  assert.equal(second, first, '同一份 raw 应命中缓存')
  assert.equal(second.api[0].enabled, true)
})

test('模型位：多服务商已配通时按家分组，每个选项带 providerId + modelId', () => {
  const state = createDefaultModelServicesState()
  const options = collectModelPositionOptions(state, ['deepseek', 'ollama'])
  assert.deepEqual(
    options.map((item) => [item.providerId, item.modelId, item.kind]),
    [
      ['deepseek', 'deepseek-chat', 'api'],
      ['deepseek', 'deepseek-reasoner', 'api'],
      ['ollama', 'llama3.1', 'local'],
      ['ollama', 'qwen2.5', 'local']
    ]
  )
  // 未配通的别家不进列表
  assert.equal(options.some((item) => item.providerId === 'openai'), false)
  assert.deepEqual(collectModelPositionOptions(state, []), [])
})

test('服务商显示名：目录名优先，未知 id 原样返回', () => {
  const state = createDefaultModelServicesState()
  assert.equal(providerDisplayName('deepseek', state), 'DeepSeek')
  assert.equal(providerDisplayName('ollama', state), 'Ollama')
  assert.equal(providerDisplayName('mystery', state), 'mystery')
})
