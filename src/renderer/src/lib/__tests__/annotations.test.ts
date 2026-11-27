// 契约测试：标注拼文本。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { toPlainText, type AnnotationItem } from '../annotations.ts'

function item(target: string, tag: string, note = '', id = 'x'): AnnotationItem {
  return { id, target, tag, note }
}

test('一条标注一行，带序号与标签', () => {
  const text = toPlainText([item('<button.msg__act> “复制”', '太大')])
  assert.equal(text, '1. [太大] <button.msg__act> “复制”')
})

test('有备注时用破折号接在后面', () => {
  const text = toPlainText([item('<aside.side>', '层级不对', '应该放在主区里')])
  assert.equal(text, '1. [层级不对] <aside.side> —— 应该放在主区里')
})

test('备注为空时不留破折号尾巴', () => {
  const text = toPlainText([item('<aside.side>', '其他', '   ')])
  assert.equal(text.includes('——'), false)
  assert.equal(text, '1. [其他] <aside.side>')
})

test('多条按顺序编号，换行分隔', () => {
  const text = toPlainText([item('a', '太大'), item('b', '太小'), item('c', '太挤')])
  assert.deepEqual(text.split('\n'), ['1. [太大] a', '2. [太小] b', '3. [太挤] c'])
})

test('空列表得到空串（不要输出一个空行）', () => {
  assert.equal(toPlainText([]), '')
})
