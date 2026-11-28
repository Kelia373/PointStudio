// 契约测试：字体注册表、脏数据回落与应用到根元素的两个变量。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  applyTypography,
  CODE_FONTS,
  DEFAULT_CODE_FONT_ID,
  DEFAULT_TYPOGRAPHY,
  DEFAULT_UI_FONT_ID,
  fontOption,
  isDefaultTypography,
  parseTypography,
  resolveTypography,
  serializeTypography,
  TYPOGRAPHY_STORAGE_KEY,
  typographyVars,
  UI_FONTS
} from '../typography.ts'

test('字体注册表：id 全局唯一、默认项存在、分类不串', () => {
  const all = [...UI_FONTS, ...CODE_FONTS]
  assert.equal(new Set(all.map((item) => item.id)).size, all.length, 'id 不能重复')
  assert.ok(UI_FONTS.some((item) => item.id === DEFAULT_UI_FONT_ID), '默认正文字体要在表里')
  assert.ok(CODE_FONTS.some((item) => item.id === DEFAULT_CODE_FONT_ID), '默认代码字体要在表里')
  for (const item of UI_FONTS) {
    assert.equal(item.category, 'ui')
    assert.ok(item.css.endsWith('sans-serif'), `${item.id} 的回退链要以 sans-serif 收尾`)
  }
  for (const item of CODE_FONTS) {
    assert.equal(item.category, 'code')
    assert.ok(item.css.endsWith('monospace'), `${item.id} 的回退链要以 monospace 收尾`)
  }
})

test('字体注册表：只收内置 OFL 与系统字体，不收商业字体', () => {
  for (const item of [...UI_FONTS, ...CODE_FONTS]) {
    assert.ok(
      item.license === 'OFL-1.1' || item.license === '系统字体',
      `${item.id} 的许可证不在白名单里：${item.license}`
    )
    assert.equal(item.bundled, item.license === 'OFL-1.1', `${item.id} 的 bundled 与许可证要一致`)
  }
  // 系统字体项不写 @font-face，因此首项是系统关键字而不是引号族名。
  const systemUi = UI_FONTS.find((item) => item.id === DEFAULT_UI_FONT_ID)!
  assert.equal(systemUi.bundled, false)
  assert.ok(!systemUi.css.startsWith("'"), '系统字体项的首项不应是引号族名')
  for (const item of [...UI_FONTS, ...CODE_FONTS].filter((entry) => entry.bundled)) {
    assert.ok(item.css.startsWith("'"), `${item.id} 应以引号族名开头`)
  }
})

test('脏 localStorage 一律回落默认，不抛错也不留半截状态', () => {
  assert.deepEqual(parseTypography(null), DEFAULT_TYPOGRAPHY)
  assert.deepEqual(parseTypography(''), DEFAULT_TYPOGRAPHY)
  assert.deepEqual(parseTypography('{'), DEFAULT_TYPOGRAPHY)
  assert.deepEqual(parseTypography('[]'), DEFAULT_TYPOGRAPHY)
  assert.deepEqual(parseTypography('"inter"'), DEFAULT_TYPOGRAPHY)
  assert.deepEqual(parseTypography(JSON.stringify({ ui: 'nope', code: 'nope' })), DEFAULT_TYPOGRAPHY)
  // 半截数据：认识的留下，不认识的补默认。
  assert.deepEqual(parseTypography(JSON.stringify({ ui: 'inter' })), {
    ui: 'inter',
    code: DEFAULT_CODE_FONT_ID
  })
  // 跨分类的 id 不能被接受。
  assert.deepEqual(parseTypography(JSON.stringify({ ui: 'jetbrains', code: 'inter' })), DEFAULT_TYPOGRAPHY)
})

test('序列化只写 id，且能原地还原', () => {
  const state = { ui: 'inter', code: 'jetbrains' }
  const raw = serializeTypography(state)
  assert.deepEqual(JSON.parse(raw), state)
  assert.deepEqual(parseTypography(raw), state)
  assert.ok(raw.length < 120, '持久化内容应该只有两个 id')
  assert.equal(TYPOGRAPHY_STORAGE_KEY, 'pointstudio.typography')
})

test('未知 id 查表回落默认，不返回 undefined', () => {
  assert.equal(fontOption('jetbrains', 'code').id, 'jetbrains')
  assert.equal(fontOption('jetbrains', 'ui').id, DEFAULT_UI_FONT_ID)
  assert.equal(fontOption('', 'code').id, DEFAULT_CODE_FONT_ID)
  assert.equal(resolveTypography({ ui: 'ghost', code: 'jetbrains' }).ui, DEFAULT_UI_FONT_ID)
})

test('applyTypography 写 --font-ui 与 --mono-code，值来自注册表', () => {
  const written: Record<string, string> = {}
  const target = {
    style: {
      setProperty(name: string, value: string): void {
        written[name] = value
      }
    }
  }
  const applied = applyTypography({ ui: 'inter', code: 'fira-code' }, target)
  assert.deepEqual(applied, { ui: 'inter', code: 'fira-code' })
  assert.equal(written['--font-ui'], fontOption('inter', 'ui').css)
  assert.equal(written['--mono-code'], fontOption('fira-code', 'code').css)

  // 脏输入写进去的也是默认链，不会把 undefined 塞进 CSS。
  applyTypography({ ui: 'ghost', code: 'ghost' }, target)
  assert.equal(written['--font-ui'], typographyVars(DEFAULT_TYPOGRAPHY).fontUi)
  assert.equal(written['--mono-code'], typographyVars(DEFAULT_TYPOGRAPHY).monoCode)
})

test('isDefaultTypography 只认两个默认 id', () => {
  assert.equal(isDefaultTypography(DEFAULT_TYPOGRAPHY), true)
  assert.equal(isDefaultTypography({ ui: 'inter', code: DEFAULT_CODE_FONT_ID }), false)
  assert.equal(isDefaultTypography({ ui: DEFAULT_UI_FONT_ID, code: 'jetbrains' }), false)
})
