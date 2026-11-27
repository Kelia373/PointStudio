// 契约测试：副画布 Markdown 预览渲染器（只覆盖明确承诺的子集）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { renderMarkdown } from '../markdownLite.ts'

test('原文里的 HTML 被转义，不能变出可执行标签', () => {
  const html = renderMarkdown('<img src=x onerror="alert(1)">')
  assert.doesNotMatch(html, /<img/)
  assert.match(html, /&lt;img/)
})

test('标题与段落各自成块', () => {
  assert.equal(renderMarkdown('# 标题'), '<h1>标题</h1>')
  assert.equal(renderMarkdown('## 二级'), '<h2>二级</h2>')
  // 段落内的换行合并成一段
  assert.equal(renderMarkdown('第一行\n第二行'), '<p>第一行 第二行</p>')
})

test('粗体 / 斜体 / 行内代码互不干扰', () => {
  assert.equal(renderMarkdown('**重要**'), '<p><strong>重要</strong></p>')
  assert.equal(renderMarkdown('*轻*'), '<p><em>轻</em></p>')
  assert.equal(renderMarkdown('`a*b*c`'), '<p><code>a*b*c</code></p>')
})

test('围栏代码块原样保留，内部的星号不解析', () => {
  const html = renderMarkdown('```\nconst a = 1 * 2\n<b>\n```')
  assert.equal(html, '<pre><code>const a = 1 * 2\n&lt;b&gt;</code></pre>')
})

test('有序 / 无序列表各自成组，切换类型会先收口', () => {
  const html = renderMarkdown('- 甲\n- 乙\n\n1. 丙\n2. 丁')
  assert.equal(html, '<ul>\n<li>甲</li>\n<li>乙</li>\n</ul>\n<ol>\n<li>丙</li>\n<li>丁</li>\n</ol>')
})

test('空草稿渲染为空串，未闭合代码块也不丢内容', () => {
  assert.equal(renderMarkdown(''), '')
  assert.equal(renderMarkdown('```\n未闭合'), '<pre><code>未闭合</code></pre>')
})
