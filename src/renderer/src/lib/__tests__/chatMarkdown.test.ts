// 契约测试：零依赖 Markdown 解析（块级 + 行内 + 安全链接）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseInlineTokens, parseMarkdownBlocks } from '../chatMarkdown.ts'

test('标题 / 段落 / 分隔线', () => {
  const blocks = parseMarkdownBlocks('# 标题\n\n第一行\n第二行\n\n---')
  assert.deepEqual(blocks[0], { type: 'heading', level: 1, text: '标题' })
  assert.deepEqual(blocks[1], { type: 'paragraph', lines: ['第一行', '第二行'] })
  assert.deepEqual(blocks[2], { type: 'hr' })
})

test('代码块：带语言、未闭合与空语言', () => {
  const closedBlocks = parseMarkdownBlocks('```ts\nconst a = 1\n```')
  assert.deepEqual(closedBlocks[0], {
    type: 'code',
    lang: 'ts',
    code: 'const a = 1',
    closed: true
  })

  const streaming = parseMarkdownBlocks('```bash\nls -la')
  assert.deepEqual(streaming[0], {
    type: 'code',
    lang: 'bash',
    code: 'ls -la',
    closed: false
  })

  const plain = parseMarkdownBlocks('```\ntext\n```')
  assert.equal(plain[0].type === 'code' && plain[0].lang, '')
})

test('列表、引用、GFM 表格', () => {
  const blocks = parseMarkdownBlocks('- 甲\n- 乙\n\n1. 一\n2. 二\n\n> 引用\n> 第二行')
  assert.deepEqual(blocks[0], { type: 'list', ordered: false, items: ['甲', '乙'] })
  assert.deepEqual(blocks[1], { type: 'list', ordered: true, items: ['一', '二'] })
  assert.deepEqual(blocks[2], { type: 'blockquote', lines: ['引用', '第二行'] })

  const table = parseMarkdownBlocks('| a | b |\n| --- | --- |\n| 1 | 2 |')
  assert.deepEqual(table[0], {
    type: 'table',
    headers: ['a', 'b'],
    rows: [['1', '2']]
  })
})

test('行内：代码包裹 ** 不误判粗体，加粗/斜体/删除线/链接', () => {
  const tokens = parseInlineTokens('`**not bold**` 与 **粗** *斜* ~~删~~ [官网](https://x.dev)')
  assert.equal(tokens[0].type, 'code')
  assert.equal(tokens[0].type === 'code' && tokens[0].value, '**not bold**')
  const strong = tokens.find((token) => token.type === 'strong')
  assert.ok(strong && strong.type === 'strong')
  assert.ok(tokens.some((token) => token.type === 'em'))
  assert.ok(tokens.some((token) => token.type === 'strike'))
  const link = tokens.find((token) => token.type === 'link')
  assert.deepEqual(link, { type: 'link', label: '官网', href: 'https://x.dev' })
})

test('安全：HTML 原样文本，javascript:/data: 链接降级', () => {
  const html = parseInlineTokens('<script>alert(1)</script>')
  assert.deepEqual(
    html.map((token) => (token.type === 'text' ? token.value : token.type)).join(''),
    '<script>alert(1)</script>'
  )

  const danger = parseInlineTokens('[点我](javascript:alert(1))')
  assert.equal(danger.every((token) => token.type !== 'link'), true)
  assert.equal(
    danger.map((token) => (token.type === 'text' ? token.value : '')).join(''),
    '[点我](javascript:alert(1))'
  )

  const data = parseInlineTokens('[文件](data:text/html,x)')
  assert.equal(data.every((token) => token.type !== 'link'), true)
})

test('行内链接只放行 https/http/mailto', () => {
  assert.equal(
    parseInlineTokens('[a](http://x)')[0].type,
    'link'
  )
  assert.equal(parseInlineTokens('[a](mailto:x@y.z)')[0].type, 'link')
  assert.equal(parseInlineTokens('[a](file:///etc/passwd)')[0].type, 'text')
})
