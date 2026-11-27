// 契约测试：样式只在 tokens 里取值的纪律。
//
// 这层不是「好看」测试，是回归防线：
// 1) 侧栏的 .side__row 曾经写着 flex: 1，被当成纵向 flex 容器的直接子元素后
//    把「主聊天（未挂载项目）」撑成 200px 的灰块——布局语义写错了只会在大窗口里露馅；
// 2) 新加的弹层又写了裸 rgba 阴影和裸字号，绕开了 tokens.css 这个单一真相源。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8')

/** 取某条选择器的声明块（本仓库的 CSS 是平的，没有嵌套）。 */
function block(selector: string): string {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `app.css 里找不到选择器 ${selector}`)
  const open = css.indexOf('{', start)
  const close = css.indexOf('}', open)
  return css.slice(open + 1, close)
}

test('共享行样式不再用 flex: 1（纵向容器里会把行撑满整屏）', () => {
  const shared = block('.side__feat,')
  assert.match(shared, /flex:\s*none/)
  assert.doesNotMatch(shared, /flex:\s*1\b/)
})

test('横向排布的两处显式把 flex 收回 1，等于覆盖共享的 flex: none', () => {
  assert.match(block('.side__agent-row .side__row'), /flex:\s*1\b/)
  assert.match(block('.side__feat-row .side__feat'), /flex:\s*1\b/)
})

test('「主聊天」那一行定高定宽，不再参与纵向分配', () => {
  const axis = block('.side__row--axis')
  assert.match(axis, /flex:\s*none/)
  assert.match(axis, /height:\s*30px/)
})

test('弹层阴影只用 tokens.css 的 --shadow-pop，不写裸 rgba', () => {
  assert.match(block('.dispatch-pill__pop'), /box-shadow:\s*var\(--shadow-pop\)/)
  assert.match(block('.spark-panel'), /box-shadow:\s*var\(--shadow-pop\)/)
  assert.match(block('.route-badge__pop'), /box-shadow:\s*var\(--shadow-pop\)/)
  assert.equal(/box-shadow:[^;]*rgba\(/.test(css), false, 'app.css 里还有裸 rgba 阴影')
})

test('字号一律走 --fs-* 阶梯，不出现裸 px', () => {
  assert.equal(/font-size:\s*\d+px/.test(css), false, 'app.css 里还有裸 px 字号')
})

test('令牌本身存在：tokens.css 定义了 --shadow-pop 与 --fs-xs', () => {
  const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8')
  assert.match(tokens, /--shadow-pop:/)
  assert.match(tokens, /--fs-xs:/)
})
