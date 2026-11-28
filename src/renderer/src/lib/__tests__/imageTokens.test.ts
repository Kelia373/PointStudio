// 契约测试：输入框缩略图与行内 [Image #N] 胶囊的双向联动。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  deleteTokenAtCaret,
  insertImageTokenAtCaret,
  parseTextWithImageTokens,
  removeImageSlot,
  renumber,
  shouldShowMessageText,
  slotsInText,
  stripImageTokens,
  syncImagesWithText,
  type PendingImage
} from '../imageTokens.ts'

function image(index: number): PendingImage {
  return {
    index,
    dto: {
      id: `00000000-0000-4000-8000-00000000000${index}`,
      mimeType: 'image/png',
      name: `img${index}.png`,
      sizeBytes: 10
    },
    previewUrl: `data:image/png;base64,AA${index}`
  }
}

function images(count: number): PendingImage[] {
  return Array.from({ length: count }, (_item, index) => image(index + 1))
}

test('光标处插入占位符：自动补空格，光标落在标记之后', () => {
  const first = insertImageTokenAtCaret('帮我看下', 4, 1)
  assert.equal(first.nextText, '帮我看下 [Image #1] ')
  assert.equal(first.nextCaret, first.nextText.length)

  const middle = insertImageTokenAtCaret('ab', 1, 2)
  assert.equal(middle.nextText, 'a [Image #2] b')
})

test('解析：文本与图片引用交替出现，顺序不乱', () => {
  const parts = parseTextWithImageTokens('看 [Image #1] 和 [Image #2] 的区别')
  assert.deepEqual(parts, [
    { type: 'text', value: '看 ' },
    { type: 'image-ref', slot: 1 },
    { type: 'text', value: ' 和 ' },
    { type: 'image-ref', slot: 2 },
    { type: 'text', value: ' 的区别' }
  ])
})

test('纯图判定：剥掉占位符后没有文字就是纯图', () => {
  assert.equal(stripImageTokens('[Image #1] [Image #2]'), '')
  assert.equal(shouldShowMessageText('[Image #1]', 1), false)
  assert.equal(shouldShowMessageText('看这张 [Image #1]', 1), true)
  assert.equal(shouldShowMessageText('', 1), false)
  assert.equal(shouldShowMessageText('', 0), false)
})

test('删中间一张：文本标记与图片一起移除，并把后面的编号压紧', () => {
  const state = { text: 'a [Image #1] b [Image #2] c [Image #3]', images: images(3) }
  const next = removeImageSlot(state.text, state.images, 2)

  assert.equal(next.text, 'a [Image #1] b c [Image #2]')
  assert.deepEqual(
    next.images.map((item) => item.index),
    [1, 2]
  )
  // 原来第 3 张顶上来接替 #2
  assert.equal(next.images[1].dto.id, image(3).dto.id)
})

test('删第一张：剩下的从 1 开始重新编号', () => {
  const state = { text: '[Image #1] [Image #2]', images: images(2) }
  const next = removeImageSlot(state.text, state.images, 1)
  assert.equal(next.text, ' [Image #1]')
  assert.deepEqual(next.images.map((item) => item.index), [1])
  assert.equal(next.images[0].dto.id, image(2).dto.id)
})

test('退格删掉文本标签：图片跟着消失，不留幽灵附图', () => {
  const state = { text: '[Image #1] [Image #3]', images: images(3) }
  // 用户把 #2 的标签退格删了
  const next = syncImagesWithText(state.text, state.images)
  assert.deepEqual(
    next.images.map((item) => item.index),
    [1, 2]
  )
  assert.equal(next.images[1].dto.id, image(3).dto.id, '#3 顶上 #2')
  assert.equal(slotsInText(next.text).length, 2)
})

test('renumber：文本与图片都按出现顺序压成 1..k', () => {
  const next = renumber('[Image #2] 中间 [Image #5]', [image(2), image(5)])
  assert.equal(next.text, '[Image #1] 中间 [Image #2]')
  assert.deepEqual(next.images.map((item) => item.index), [1, 2])
})

test('没有标签的图片不会被丢掉（补在末尾，保持可见）', () => {
  const next = renumber('只有文字', images(2))
  assert.deepEqual(next.images.map((item) => item.index), [1, 2])
  assert.equal(next.text, '只有文字')
})

test('原子退格：光标紧贴标记右侧时整颗删掉，返回槽位号', () => {
  const text = '看 [Image #1] 这张'
  const caret = text.indexOf('[Image #1]') + '[Image #1]'.length
  const result = deleteTokenAtCaret(text, caret, 'backspace')
  assert.equal(result.text, '看  这张')
  assert.equal(result.caret, 2)
  assert.equal(result.removedSlot, 1)
})

test('原子删除：光标紧贴标记左侧时删掉它', () => {
  const text = 'a[Image #2]b'
  const result = deleteTokenAtCaret(text, 1, 'delete')
  assert.equal(result.text, 'ab')
  assert.equal(result.removedSlot, 2)
})

test('光标不贴着标记时不动（正常退格交给浏览器）', () => {
  const text = 'abc [Image #1]'
  const result = deleteTokenAtCaret(text, 2, 'backspace')
  assert.equal(result.text, text)
  assert.equal(result.removedSlot, null)
})
