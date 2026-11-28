// 静态红线护栏：字体链路里最容易悄悄坏掉的三处——
// 1. <code>/<pre> 没重置，Chromium UA 的裸 monospace 会让中文 Windows 退化成新宋体；
// 2. 注册表里加了字体，但 fonts.css / woff2 没跟上；
// 3. 有人图省事把 @font-face 指向 CDN，离线机器直接掉字。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { CODE_FONTS, UI_FONTS } from '../typography.ts'

const APP_CSS = fileURLToPath(new URL('../../styles/app.css', import.meta.url))
const FONTS_CSS = fileURLToPath(new URL('../../styles/fonts.css', import.meta.url))

function read(path: string): string {
  return readFileSync(path, 'utf8')
}

test('app.css 必须把 code / pre 显式重置到 --mono', () => {
  const css = read(APP_CSS)
  const rule = /(^|\n)code,\s*kbd,\s*samp,\s*pre\s*\{([^}]*)\}/.exec(css)
  assert.ok(rule, 'app.css 缺少 code/kbd/samp/pre 的字体重置（P0：中文 Windows 会退化成新宋体）')
  assert.match(rule[2]!, /font-family:\s*var\(--mono\)/, '重置必须走 var(--mono)，不能写死字体名')
})

test('注册表里每个内置字体都要有 @font-face 与真实 woff2 文件', () => {
  const css = read(FONTS_CSS)
  const bundled = [...UI_FONTS, ...CODE_FONTS].filter((item) => item.bundled)
  assert.ok(bundled.length >= 10, '内置字体数量异常，注册表可能被误删')

  const declared = new Set<string>()
  for (const match of css.matchAll(/font-family:\s*'([^']+)'/g)) {
    declared.add(match[1]!)
  }
  for (const item of bundled) {
    const family = /^'([^']+)'/.exec(item.css)?.[1]
    assert.ok(family, `${item.id} 的首项应是引号族名`)
    assert.ok(declared.has(family), `fonts.css 缺少 '${family}' 的 @font-face`)
  }

  const files = [...css.matchAll(/url\('\.\.\/assets\/fonts\/([^']+)'\)/g)].map((match) => match[1]!)
  assert.ok(files.length >= bundled.length, 'fonts.css 引用的字体文件数量少于注册表')
  for (const file of files) {
    const path = fileURLToPath(new URL(`../../assets/fonts/${file}`, import.meta.url))
    assert.ok(existsSync(path), `fonts.css 引用了不存在的文件：${file}`)
  }
})

test('@font-face 只认随包文件，不许出现远程地址', () => {
  const css = read(FONTS_CSS)
  assert.equal(/https?:\/\//.test(css), false, 'fonts.css 不能引用远程字体（离线可用是硬要求）')
  assert.match(css, /font-display:\s*swap/, '缺少 font-display: swap，首屏会空白等字体')
})
