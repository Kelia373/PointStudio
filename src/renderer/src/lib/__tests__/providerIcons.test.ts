// 契约测试：厂商 id → 图标映射，未知永远回退 custom。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { providerIconKey } from '../providerIcons.ts'

test('常见厂商映射到对应品牌图标', () => {
  assert.equal(providerIconKey('deepseek'), 'deepseek')
  assert.equal(providerIconKey('opencode-go'), 'opencode')
  assert.equal(providerIconKey('openai'), 'openai')
  assert.equal(providerIconKey('anthropic'), 'anthropic')
  assert.equal(providerIconKey('gemini'), 'gemini')
  assert.equal(providerIconKey('lm-studio'), 'lmstudio')
  assert.equal(providerIconKey('claude-code'), 'claudecode')
})

test('复用映射：kimi / qwen / mistral 的 CLI 共用同一品牌', () => {
  assert.equal(providerIconKey('kimi-cli'), 'moonshot')
  assert.equal(providerIconKey('qwen-code'), 'qwen')
  assert.equal(providerIconKey('mistral-vibe'), 'mistral')
  assert.equal(providerIconKey('custom-command'), 'custom')
})

test('未知或空值稳定回退 custom，不抛错', () => {
  assert.equal(providerIconKey('not-a-provider'), 'custom')
  assert.equal(providerIconKey(''), 'custom')
  assert.equal(providerIconKey(null), 'custom')
  assert.equal(providerIconKey(undefined), 'custom')
})

test('完整厂商目录的每个 id 都有品牌图标，不停在 custom 兜底', async () => {
  const { createDefaultModelServicesState } = await import('../modelServices.ts')
  const state = createDefaultModelServicesState()
  const ids = [
    ...state.api.map((item) => item.id),
    ...state.cli.map((item) => item.id),
    ...state.local.map((item) => item.id)
  ]
  for (const id of ids) {
    if (id.startsWith('custom')) {
      // 自定义项本来就该回退 custom 图标
      assert.equal(providerIconKey(id), 'custom')
      continue
    }
    assert.notEqual(providerIconKey(id), 'custom', `${id} 缺少品牌图标`)
  }
})
