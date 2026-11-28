// 契约测试：输入框行内胶囊的解析 / 序列化 / 逻辑光标互算。
//
// 这些用例锁的是「删掉前面的图以后，剩余胶囊与文字流不能错位」——
// 一旦 serialize 与 caret 换算对不上，contentEditable 就会把整颗胶囊
// 拆成半截文本，或者把光标放到图片中间。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  caretAfterRenumber,
  getLogicalCaretOffset,
  nodeLogicalLength,
  parseEditorSegments,
  sanitizePastedText,
  serializeEditorNodes,
  setLogicalCaretOffset,
  type EditorDomNode
} from '../inlineChipEditor.ts'
import { removeImageSlot, type PendingImage } from '../imageTokens.ts'

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

function text(value: string): EditorDomNode {
  return { kind: 'text', text: value }
}

function chip(slot: number): EditorDomNode {
  return { kind: 'element', tag: 'span', attrs: { 'data-image-slot': String(slot) } }
}

function br(sentinel = false): EditorDomNode {
  return sentinel
    ? { kind: 'element', tag: 'br', attrs: { 'data-sentinel': '1' } }
    : { kind: 'element', tag: 'br' }
}

test('解析：文字 / 图片引用 / 换行按顺序切段', () => {
  assert.deepEqual(parseEditorSegments('看 [Image #1] 和 [Image #2]'), [
    { type: 'text', value: '看 ' },
    { type: 'image-ref', slot: 1 },
    { type: 'text', value: ' 和 ' },
    { type: 'image-ref', slot: 2 }
  ])

  assert.deepEqual(parseEditorSegments('第一行\n第二行'), [
    { type: 'text', value: '第一行' },
    { type: 'br' },
    { type: 'text', value: '第二行' }
  ])

  // 连续空行与行尾换行都要能原样还原，不能吞行。
  assert.deepEqual(parseEditorSegments('a\n\n'), [
    { type: 'text', value: 'a' },
    { type: 'br' },
    { type: 'br' }
  ])
})

test('序列化：文本原样、胶囊还原占位符、换行还原 \\n、哨兵忽略', () => {
  const nodes: EditorDomNode[] = [
    text('看 '),
    chip(1),
    text(' 和 '),
    chip(2),
    br(),
    text('第二行'),
    br(true)
  ]
  assert.equal(serializeEditorNodes(nodes), '看 [Image #1] 和 [Image #2]\n第二行')
})

test('序列化：嵌套块里的胶囊也能还原（浏览器偶尔会包一层 div）', () => {
  const nodes: EditorDomNode[] = [
    { kind: 'element', tag: 'div', children: [text('a'), chip(3)] }
  ]
  assert.equal(serializeEditorNodes(nodes), 'a[Image #3]')
})

test('胶囊整颗按 [Image #N] 计长，光标不会落进图片中间', () => {
  const nodes: EditorDomNode[] = [text('ab'), chip(2), text('cd')]
  assert.equal(nodeLogicalLength(nodes[1]), '[Image #2]'.length)

  // 文本节点内
  assert.equal(getLogicalCaretOffset(nodes, [0], 1), 1)
  // 胶囊右边界
  assert.equal(getLogicalCaretOffset(nodes, [1], 1), 2 + '[Image #2]'.length)
  // 胶囊左侧
  assert.equal(getLogicalCaretOffset(nodes, [1], 0), 2)
  // 末尾
  assert.equal(getLogicalCaretOffset(nodes, [2], 2), 4 + '[Image #2]'.length)
  // 根节点上的 offset（无路径）也成立
  assert.equal(getLogicalCaretOffset(nodes, [], 2), 2 + '[Image #2]'.length)
})

test('逻辑位移与节点路径互算：每个合法位置都能原样往返', () => {
  const nodes: EditorDomNode[] = [text('ab'), chip(1), br(), text('cd'), br(true)]
  const total = nodes.reduce((sum, node) => sum + nodeLogicalLength(node), 0)
  assert.equal(total, 2 + '[Image #1]'.length + 1 + 2)

  // 胶囊与换行是原子的：只有前后两个落点；文字节点内逐字都合法。
  const legal: number[] = []
  let position = 0
  for (const node of nodes) {
    const length = nodeLogicalLength(node)
    if (node.kind === 'text') {
      for (let inside = 0; inside <= length; inside += 1) {
        legal.push(position + inside)
      }
    } else {
      legal.push(position)
      if (length > 0) {
        legal.push(position + length)
      }
    }
    position += length
  }

  for (const offset of [...new Set(legal)]) {
    const caret = setLogicalCaretOffset(nodes, offset)
    assert.equal(getLogicalCaretOffset(nodes, caret.path, caret.offset), offset, `offset=${offset}`)
  }
})

test('删掉第一张图：剩余图片与胶囊当帧重排成连续 #1..#k', () => {
  const images = [image(1), image(2), image(3)]
  const next = removeImageSlot('看 [Image #1] 和 [Image #2] 还有 [Image #3]', images, 1)

  assert.equal(next.text, '看 和 [Image #1] 还有 [Image #2]')
  assert.deepEqual(
    next.images.map((item) => item.index),
    [1, 2]
  )
  // 原 #2 / #3 的实体（id）保持顺序，只是编号前移——不能串图。
  assert.deepEqual(
    next.images.map((item) => item.dto.id),
    [images[1].dto.id, images[2].dto.id]
  )

  // 重排后的文本再解析，胶囊编号与图片数组严格对齐。
  const slots = parseEditorSegments(next.text)
    .filter((segment) => segment.type === 'image-ref')
    .map((segment) => (segment.type === 'image-ref' ? segment.slot : 0))
  assert.deepEqual(slots, [1, 2])
})

test('粘贴净化：只留纯文本，统一换行并剥掉重复的图片引用', () => {
  assert.equal(sanitizePastedText('第一行\r\n第二行'), '第一行\n第二行')
  assert.equal(sanitizePastedText('旧的\r换行'), '旧的\n换行')

  // 复制自己输入框里的内容会把 [Image #N] 一起带出来：再粘一次会出现两个
  // 同号胶囊 → 胶囊与实体失去 1:1，必须在入口剥掉。
  assert.equal(sanitizePastedText('看 [Image #1] 和 [Image #2]'), '看 和 ')
  assert.equal(sanitizePastedText('[Image #3]'), '')

  // 用户排版不能动：连续空格、缩进、字面量标签都当普通文字。
  assert.equal(sanitizePastedText('  hello  world  '), '  hello  world  ')
  assert.equal(sanitizePastedText('<b>不是富文本</b>'), '<b>不是富文本</b>')
})

test('删图后光标重定位：按文字字符锚定，不随重新编号漂移', () => {
  const oldText = '看 [Image #1] 和 [Image #2] 结尾'
  const next = removeImageSlot(oldText, [image(1), image(2)], 1)
  assert.equal(next.text, '看 和 [Image #1] 结尾')

  // 光标原来在第二张图之后（#2 结束处）：重排后应对应新的 #1 之后。
  const caretAfterSecond = oldText.indexOf('[Image #2]') + '[Image #2]'.length
  const mapped = caretAfterRenumber(oldText, next.text, caretAfterSecond)
  assert.equal(next.text.slice(0, mapped), '看 和 [Image #1] ')

  // 光标在整段末尾：钉在末尾，不越过。
  assert.equal(caretAfterRenumber(oldText, next.text, oldText.length), next.text.length)

  // 光标在第一张图之前：普通文字没变，位置原样。
  assert.equal(caretAfterRenumber(oldText, next.text, 1), 1)
})
