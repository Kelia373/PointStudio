// 契约测试：关键词检索（中文二元组切词、打分、排序、边界输入）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { searchChunks, tokenize, type SearchableChunk } from '../search.ts'

function chunk(id: string, text: string, source = 'doc.md'): SearchableChunk {
  return { id, text, source }
}

test('中文按二元组切词，单字也能单独成词', () => {
  assert.deepEqual(tokenize('你好世界'), ['你好', '好世', '世界'])
  assert.deepEqual(tokenize('猫'), ['猫'])
})

test('英文按单词切词并统一小写', () => {
  assert.deepEqual(tokenize('Hello World_2'), ['hello', 'world_2'])
})

test('中英混合都能切', () => {
  const terms = tokenize('用 PDF 导出')
  assert.ok(terms.includes('pdf') || terms.includes('PDF'.toLowerCase()))
  assert.ok(terms.some((term) => term.length === 2))
})

test('命中的块按分数降序，limit 生效', () => {
  const chunks = [
    chunk('a', '计划计划计划'),
    chunk('b', '计划'),
    chunk('c', '完全不相关的内容')
  ]
  const hits = searchChunks('计划', chunks, { limit: 2 })

  assert.equal(hits.length, 2)
  assert.equal(hits[0].chunk.id, 'a', '出现次数多的应排前面')
  assert.equal(hits[1].chunk.id, 'b')
})

test('检索返回来源与命中词，便于引用与高亮', () => {
  const hits = searchChunks('工作台', [chunk('a', '这是一个 AI 工作台。', 'notes/intro.md')])
  assert.equal(hits.length, 1)
  assert.equal(hits[0].chunk.source, 'notes/intro.md')
  assert.ok(hits[0].matchedTerms.some((term) => term.includes('工作')))
})

test('英文检索大小写不敏感', () => {
  const hits = searchChunks('PDF', [chunk('a', '用 pdf 导出文件')])
  assert.equal(hits.length, 1)
})

test('无命中返回空数组，空查询也返回空', () => {
  assert.deepEqual(searchChunks('不存在的东西', [chunk('a', '无关内容')]), [])
  assert.deepEqual(searchChunks('   ', [chunk('a', '内容')]), [])
  assert.deepEqual(searchChunks('内容', []), [])
})

test('查询里的正则元字符不会让检索崩掉', () => {
  assert.doesNotThrow(() => searchChunks('(a+b)[c]', [chunk('a', '内容')]))
  assert.doesNotThrow(() => searchChunks('\\', [chunk('a', '内容')]))
})

test('位置靠前的命中略占优势（同次数时）', () => {
  const early = chunk('early', '计划在这里出现，后面还有很多别的说明文字。')
  const late = chunk('late', '这里先是一大段与本主题无关的铺垫，然后才提到计划。')
  const hits = searchChunks('计划', [late, early])

  assert.equal(hits[0].chunk.id, 'early', '同样一次命中时，靠前的应优先')
})
