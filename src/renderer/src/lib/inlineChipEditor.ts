// lib/inlineChipEditor —— 输入框「行内原子胶囊」的纯逻辑层。
//
// 编辑区是 contentEditable：文字是文本节点、换行是 <br>、图片是
// `<span data-image-slot="N">` 的原子胶囊。这一层只做三件事：
// 1. 把 draft 字符串切成段（文字 / 换行 / 图片引用）；
// 2. 把编辑区的节点树还原成 draft（胶囊还原成 `[Image #N]`，撑行哨兵忽略）；
// 3. 逻辑光标位移与 DOM 位置互算（胶囊整颗按 `[Image #N]` 的长度计）。
//
// 与真实 DOM 解耦，方便单测；组件侧只做一层浅适配。
import { imageToken, parseTextWithImageTokens } from './imageTokens.ts'

export type EditorSegment =
  | { type: 'text'; value: string }
  | { type: 'image-ref'; slot: number }
  | { type: 'br' }

/** 把 draft 切成可渲染的段：换行显式成 br，其余交给 imageTokens。 */
export function parseEditorSegments(draft: string): EditorSegment[] {
  const segments: EditorSegment[] = []
  draft.split('\n').forEach((line, index) => {
    if (index > 0) {
      segments.push({ type: 'br' })
    }
    if (line === '') {
      return
    }
    for (const part of parseTextWithImageTokens(line)) {
      if (part.type === 'text') {
        segments.push({ type: 'text', value: part.value })
      } else {
        segments.push({ type: 'image-ref', slot: part.slot })
      }
    }
  })
  return segments
}

export interface EditorTextNode {
  kind: 'text'
  text: string
}

export interface EditorElementNode {
  kind: 'element'
  /** 小写标签名：`br` / `span` / `div` … */
  tag: string
  /** 只关心 data-* 两个属性；其余不参与序列化。 */
  attrs?: Readonly<Record<string, string | null>>
  children?: ReadonlyArray<EditorDomNode>
}

export type EditorDomNode = EditorTextNode | EditorElementNode

const CHIP_SLOT = 'data-image-slot'
const SENTINEL = 'data-sentinel'

function slotOf(node: EditorElementNode): number | null {
  const raw = node.attrs?.[CHIP_SLOT]
  if (raw === undefined || raw === null) {
    return null
  }
  const slot = Number(raw)
  return Number.isInteger(slot) && slot > 0 ? slot : null
}

/** 节点在 draft 里占几个字符（胶囊算整颗 `[Image #N]`，哨兵 br 算 0）。 */
export function nodeLogicalLength(node: EditorDomNode): number {
  if (node.kind === 'text') {
    return node.text.length
  }
  if (node.attrs?.[SENTINEL] !== undefined) {
    return 0
  }
  if (node.tag === 'br') {
    return 1
  }
  const slot = slotOf(node)
  if (slot !== null) {
    return imageToken(slot).length
  }
  return (node.children ?? []).reduce((total, child) => total + nodeLogicalLength(child), 0)
}

/** 节点树 → draft。哨兵 br 只是撑行用，不参与文本。 */
export function serializeEditorNodes(nodes: ReadonlyArray<EditorDomNode>): string {
  let text = ''
  for (const node of nodes) {
    if (node.kind === 'text') {
      text += node.text
      continue
    }
    if (node.attrs?.[SENTINEL] !== undefined) {
      continue
    }
    if (node.tag === 'br') {
      text += '\n'
      continue
    }
    const slot = slotOf(node)
    if (slot !== null) {
      text += imageToken(slot)
      continue
    }
    text += serializeEditorNodes(node.children ?? [])
  }
  return text
}

/** 逻辑光标位置（与 draft 的下标同一坐标系）。 */
export function getLogicalCaretOffset(
  nodes: ReadonlyArray<EditorDomNode>,
  path: ReadonlyArray<number>,
  offset: number
): number {
  const before = (list: ReadonlyArray<EditorDomNode>, index: number): number => {
    let total = 0
    for (let i = 0; i < index && i < list.length; i += 1) {
      total += nodeLogicalLength(list[i])
    }
    return total
  }

  const walk = (
    list: ReadonlyArray<EditorDomNode>,
    rest: ReadonlyArray<number>,
    innerOffset: number
  ): number | null => {
    if (rest.length === 0) {
      return before(list, innerOffset)
    }
    const node = list[rest[0]]
    if (node === undefined) {
      return null
    }
    const base = before(list, rest[0])
    if (node.kind === 'text') {
      return base + Math.max(0, Math.min(innerOffset, node.text.length))
    }
    const length = nodeLogicalLength(node)
    if (rest.length === 1) {
      if (node.tag === 'br' || slotOf(node) !== null) {
        return base + (innerOffset > 0 ? length : 0)
      }
      return base + before(node.children ?? [], innerOffset)
    }
    const inner = walk(node.children ?? [], rest.slice(1), innerOffset)
    return inner === null ? null : base + inner
  }

  const resolved = walk(nodes, path, offset)
  if (resolved !== null) {
    return resolved
  }
  return nodes.reduce((total, node) => total + nodeLogicalLength(node), 0)
}

/**
 * 删除/重排后重新定位光标。
 *
 * 删一张图会删掉一个 `[Image #N]`，并把后面的 `#2/#3` 缩短成 `#1/#2`——
 * 直接用旧偏移会把光标落偏几位。这里用「非 token 文字字符」当锚：
 * 普通文字在重排里不改（除删图时合并过一对空格），所以按文字计数最稳。
 */
export function caretAfterRenumber(oldText: string, newText: string, caret: number): number {
  const map = (text: string): { positions: number[] } => {
    const positions: number[] = []
    let cursor = 0
    const token = /\[Image #\d+\]/g
    let match: RegExpExecArray | null
    while ((match = token.exec(text)) !== null) {
      for (; cursor < match.index; cursor += 1) {
        positions.push(cursor)
      }
      cursor = match.index + match[0].length
    }
    for (; cursor < text.length; cursor += 1) {
      positions.push(cursor)
    }
    return { positions }
  }

  const before = map(oldText)
  const after = map(newText)
  let plainIndex = 0
  while (plainIndex < before.positions.length && before.positions[plainIndex] < caret) {
    plainIndex += 1
  }
  if (plainIndex >= after.positions.length) {
    return newText.length
  }
  return after.positions[plainIndex]
}

export interface EditorCaret {
  path: number[]
  offset: number
}

/**
 * 粘贴净化：只留纯文本。
 *
 * - `\r\n` / `\r` 统一成 `\n`（编辑器内部只用 `\n`，`<br>` 由渲染层生成）；
 * - 剥掉 `[Image #N]`：同一个 slot 在文字里出现两次，胶囊与实体就不再 1:1；
 * - 其它一律原样保留（连续空格、缩进、字面量 `<b>` 都当普通文字，JSON 不转义）。
 *
 * HTML 永远不会进 DOM：组件里粘贴前先 `preventDefault`，只插文本节点。
 */
export function sanitizePastedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\[Image #\d+\]\s*/g, '')
}

/** 逻辑光标位置 → 节点路径（组件用它落回真实 Selection）。 */
export function setLogicalCaretOffset(
  nodes: ReadonlyArray<EditorDomNode>,
  logicalOffset: number
): EditorCaret {
  const descend = (
    list: ReadonlyArray<EditorDomNode>,
    remaining: number,
    prefix: number[]
  ): EditorCaret => {
    let rest = remaining
    for (let index = 0; index < list.length; index += 1) {
      const node = list[index]
      const length = nodeLogicalLength(node)
      if (rest > length) {
        rest -= length
        continue
      }
      if (node.kind === 'text') {
        return { path: [...prefix, index], offset: Math.max(0, Math.min(rest, node.text.length)) }
      }
      if (node.tag === 'br' || slotOf(node) !== null) {
        return { path: [...prefix, index], offset: rest > 0 ? 1 : 0 }
      }
      if (length === 0) {
        continue
      }
      return descend(node.children ?? [], rest, [...prefix, index])
    }
    // 落在末尾：交给最后一个可落点的父节点。
    return { path: prefix, offset: list.length }
  }

  return descend(nodes, Math.max(0, logicalOffset), [])
}
