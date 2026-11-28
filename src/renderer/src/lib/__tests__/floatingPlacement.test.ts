// 契约测试：浮层定位（向下放不下要往上翻，且不许出界）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { placeFloatingBox, toRect, type AnchorPoint, type AnchorRect } from '../floatingPlacement.ts'

const viewport = { width: 1200, height: 800 }

function rect(partial: Partial<AnchorRect>): AnchorRect {
  return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, ...partial }
}

test('下方空间够：贴在锚点下方，留出 gap', () => {
  const anchor = rect({ top: 100, bottom: 128, left: 40, right: 240, width: 200, height: 28 })
  const placed = placeFloatingBox(anchor, { width: 300, height: 260 }, viewport)
  assert.equal(placed.side, 'below')
  assert.equal(placed.top, 134)
  assert.equal(placed.left, 40)
  assert.equal(placed.maxHeight, 800 - 128 - 6 - 12)
})

test('下方放不下、上方放得下：翻到上方，且底边贴着锚点', () => {
  const anchor = rect({ top: 700, bottom: 728, left: 40, right: 240, width: 200, height: 28 })
  const placed = placeFloatingBox(anchor, { width: 300, height: 320 }, viewport)
  assert.equal(placed.side, 'above')
  assert.equal(placed.top, 700 - 6 - 320)
  assert.equal(placed.maxHeight, 700 - 6 - 12)
})

test('两边都放不下：选空间大的一侧，并把高度收到可用范围内', () => {
  const anchor = rect({ top: 300, bottom: 328, left: 40, right: 240, width: 200, height: 28 })
  const tallViewport = { width: 1200, height: 420 }
  const placed = placeFloatingBox(anchor, { width: 300, height: 600 }, tallViewport)
  // 上方 282、下方 74，翻上去能多看到内容。
  assert.equal(placed.side, 'above')
  assert.equal(placed.maxHeight, 282)
  assert.ok(placed.top >= 12)
  assert.ok(placed.top + 282 <= tallViewport.height)
})

test('右边放不下就往左夹，左边越界就贴着留白', () => {
  const rightAnchor = rect({ top: 100, bottom: 128, left: 1000, right: 1180, width: 180, height: 28 })
  const right = placeFloatingBox(rightAnchor, { width: 320, height: 200 }, viewport)
  assert.equal(right.left, 1200 - 320 - 12)

  const leftAnchor = rect({ top: 100, bottom: 128, left: 2, right: 180, width: 178, height: 28 })
  const left = placeFloatingBox(leftAnchor, { width: 320, height: 200 }, viewport)
  assert.equal(left.left, 12)
})

test('右对齐：以锚点右边为准，仍然夹在视口内', () => {
  const anchor = rect({ top: 100, bottom: 128, left: 600, right: 800, width: 200, height: 28 })
  const placed = placeFloatingBox(anchor, { width: 260, height: 200 }, viewport, { align: 'end' })
  assert.equal(placed.left, 540)
})

test('点击点菜单：把点当零尺寸锚点，同样会向上翻', () => {
  const point: AnchorPoint = { x: 300, y: 780 }
  const placed = placeFloatingBox(point, { width: 200, height: 240 }, viewport, { margin: 8 })
  assert.equal(placed.side, 'above')
  assert.equal(placed.top, 780 - 6 - 240)
  assert.equal(placed.left, 300)
})

test('比视口还大：宽度收回视口内，高度给满可用空间', () => {
  const anchor = rect({ top: 10, bottom: 30, left: 0, right: 100, width: 100, height: 20 })
  const tiny = { width: 300, height: 500 }
  const placed = placeFloatingBox(anchor, { width: 900, height: 900 }, tiny)
  assert.equal(placed.left, 12)
  assert.ok(placed.maxHeight >= 0)
  assert.ok(placed.top + placed.maxHeight <= tiny.height)
})

test('toRect 让点和矩形共用一套算法', () => {
  assert.deepEqual(toRect({ x: 5, y: 9 }), {
    top: 9,
    bottom: 9,
    left: 5,
    right: 5,
    width: 0,
    height: 0
  })
})
