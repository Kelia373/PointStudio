// lib/imageTokens —— 输入框里「缩略图托盘 ↔ 行内 [Image #N] 胶囊」的纯文本协议。
//
// 为什么用文本占位符而不是富文本编辑：输入框必须保住中文输入法合成、@ 成员、
// / 指令和 Enter 发送，任何 Rich Text 方案都会把这些重新实现一遍。
// 这里只做「字符串 ↔ 图片槽位」的双向映射，UI 负责把占位符画成胶囊。
import type { MessageImageDto } from '../../../shared/types/ipc.ts'

export interface PendingImage {
  /** 1 起的槽位号，与 `[Image #N]` 对应。 */
  index: number
  dto: MessageImageDto
  /** data URL，用于 <img src> 即时预览。 */
  previewUrl: string
}

export interface TextPart {
  type: 'text'
  value: string
}

export interface ImageRefPart {
  type: 'image-ref'
  slot: number
}

export type MessagePart = TextPart | ImageRefPart

const TOKEN = /\[Image #(\d+)\]/g

export function imageToken(slot: number): string {
  return `[Image #${slot}]`
}

/** 在光标处插入占位符，并把光标推到它后面。 */
export function insertImageTokenAtCaret(
  text: string,
  caret: number,
  slotIndex: number
): { nextText: string; nextCaret: number } {
  const safeCaret = Math.max(0, Math.min(caret, text.length))
  const token = imageToken(slotIndex)
  // 前面不是空白就补一个空格，免得 `看[Image #1]` 粘在一起。
  const needsSpace = safeCaret > 0 && !/\s/.test(text[safeCaret - 1] ?? '')
  const insertion = needsSpace ? ` ${token} ` : `${token} `
  return {
    nextText: `${text.slice(0, safeCaret)}${insertion}${text.slice(safeCaret)}`,
    nextCaret: safeCaret + insertion.length
  }
}

/** 把文本切成「普通文字 / 图片引用」两段，UI 按段渲染胶囊。 */
export function parseTextWithImageTokens(text: string): MessagePart[] {
  const parts: MessagePart[] = []
  let cursor = 0
  TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, match.index) })
    }
    parts.push({ type: 'image-ref', slot: Number(match[1]) })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) {
    parts.push({ type: 'text', value: text.slice(cursor) })
  }
  return parts
}

/** 剥掉占位符后的自然语言：判断「纯图消息」和派生标题都用它。 */
export function stripImageTokens(text: string): string {
  return text.replace(TOKEN, ' ').replace(/\s+/g, ' ').trim()
}

/** 文本里出现过哪些槽位号（去重升序）。 */
export function slotsInText(text: string): number[] {
  const found = new Set<number>()
  TOKEN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = TOKEN.exec(text)) !== null) {
    found.add(Number(match[1]))
  }
  return [...found].sort((a, b) => a - b)
}

/**
 * 重排：把编号按出现顺序压成连续的 1..k。
 *
 * 图片被删掉后必须整体重排，否则会出现「#1、#3」这种断号，用户会以为丢了一张。
 */
export function renumber(
  text: string,
  images: readonly PendingImage[]
): { text: string; images: PendingImage[] } {
  const order: number[] = []
  for (const slot of slotsInText(text)) {
    if (images.some((image) => image.index === slot) && !order.includes(slot)) {
      order.push(slot)
    }
  }
  // 文本里没出现的图片（用户删了标签）也按原顺序补在末尾，避免幽灵图。
  for (const image of images) {
    if (!order.includes(image.index)) {
      order.push(image.index)
    }
  }

  const mapping = new Map<number, number>()
  order.forEach((oldSlot, position) => mapping.set(oldSlot, position + 1))

  const nextText = text.replace(TOKEN, (_match, raw: string) => {
    const next = mapping.get(Number(raw))
    return next === undefined ? '' : imageToken(next)
  })
  const nextImages = order
    .map((oldSlot) => images.find((image) => image.index === oldSlot))
    .filter((image): image is PendingImage => image !== undefined)
    .map((image, position) => ({ ...image, index: position + 1 }))

  return { text: nextText.replace(/  +/g, ' '), images: nextImages }
}

/**
 * 删掉一张图：同时剥掉文本里的占位符，再整体重排。
 * 上下 1:1 联动靠的就是这一步，不存在「标签还在、图没了」的中间态。
 */
export function removeImageSlot(
  text: string,
  images: readonly PendingImage[],
  slotToRemove: number
): { text: string; images: PendingImage[] } {
  const withoutToken = text.replace(new RegExp(`\\[Image #${slotToRemove}\\]`, 'g'), '')
  const remaining = images.filter((image) => image.index !== slotToRemove)
  return renumber(withoutToken.replace(/  +/g, ' '), remaining)
}

/**
 * 用户用退格删掉了文本里的标签：把对应图片也去掉并重排。
 * 返回新状态；没有变化时返回原对象（React 可以不重渲染）。
 */
export function syncImagesWithText(
  text: string,
  images: readonly PendingImage[]
): { text: string; images: PendingImage[] } {
  const present = new Set(slotsInText(text))
  const missing = images.some((image) => !present.has(image.index))
  if (!missing) {
    return { text, images: [...images] }
  }
  const kept = images.filter((image) => present.has(image.index))
  return renumber(text, kept)
}

/** 已发送消息：只贴图不打字时不要渲染孤立的空文本行。 */
export function shouldShowMessageText(text: string, _imageCount: number): boolean {
  return stripImageTokens(text) !== ''
}

/**
 * 原子退格 / 删除：光标紧贴 [Image #N] 时整颗删掉，而不是一个字一个字啃。
 * 返回新的文本、新的光标，以及被删掉的槽位号（调用方据此同步移除缩略图并重排）。
 */
export function deleteTokenAtCaret(
  text: string,
  caret: number,
  key: 'backspace' | 'delete'
): { text: string; caret: number; removedSlot: number | null } {
  const safeCaret = Math.max(0, Math.min(caret, text.length))
  const pattern = /\[Image #(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index
    const end = start + match[0].length
    const hit = key === 'backspace' ? end === safeCaret : start === safeCaret
    if (!hit) {
      continue
    }
    return {
      text: text.slice(0, start) + text.slice(end),
      caret: start,
      removedSlot: Number(match[1])
    }
  }
  return { text, caret: safeCaret, removedSlot: null }
}
