// lib/floatingPlacement —— 浮层该往哪边弹、会不会出界的纯计算。
//
// 为什么单独拎出来：模型选择器、筛选菜单、右键菜单都用固定定位自己算坐标，
// 谁都能算漏一处，结果就是「下方空间不够，还硬往下弹，被窗口底边切掉」。
// 这里只做算术，不碰 DOM；调用方量好尺寸再进来，方便单测各种极端视口。

export interface AnchorPoint {
  x: number
  y: number
}

export interface AnchorRect {
  top: number
  bottom: number
  left: number
  right: number
  width: number
  height: number
}

export interface BoxSize {
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

export interface PlacementOptions {
  /** 浮层与锚点的呼吸距离。 */
  gap?: number
  /** 浮层与视口边缘的最小留白。 */
  margin?: number
  /** 水平对齐：左对齐锚点，或右对齐锚点。 */
  align?: 'start' | 'end'
  /** 想优先试的一侧；默认先向下。 */
  prefer?: 'below' | 'above'
}

export interface Placement {
  left: number
  top: number
  /** 最终落在锚点的哪一侧。 */
  side: 'below' | 'above'
  /** 该侧可用高度：内容更高时由调用方滚动，绝不撑出视口。 */
  maxHeight: number
}

const DEFAULT_GAP = 6
const DEFAULT_MARGIN = 12

export function toRect(anchor: AnchorRect | AnchorPoint): AnchorRect {
  if ('x' in anchor) {
    return { top: anchor.y, bottom: anchor.y, left: anchor.x, right: anchor.x, width: 0, height: 0 }
  }
  return anchor
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) {
    return min
  }
  return Math.min(Math.max(value, min), max)
}

/**
 * 算出浮层的 left/top 与可用高度。
 *
 * 规则（按优先级）：
 * 1. 放得下就按偏好那侧放；
 * 2. 偏好侧放不下、另一侧放得下，就翻过去；
 * 3. 两边都放不下，挑空间大的一侧，并把高度收到可用范围内；
 * 4. 水平方向夹在视口里，宁可贴边也不出界。
 */
export function placeFloatingBox(
  anchor: AnchorRect | AnchorPoint,
  box: BoxSize,
  viewport: Viewport,
  options: PlacementOptions = {}
): Placement {
  const gap = options.gap ?? DEFAULT_GAP
  const margin = options.margin ?? DEFAULT_MARGIN
  const rect = toRect(anchor)
  const prefer = options.prefer ?? 'below'

  const spaceBelow = viewport.height - rect.bottom - gap - margin
  const spaceAbove = rect.top - gap - margin
  const fitsBelow = box.height <= spaceBelow
  const fitsAbove = box.height <= spaceAbove

  let side: 'below' | 'above'
  if (prefer === 'below') {
    side = fitsBelow || !fitsAbove ? 'below' : 'above'
  } else {
    side = fitsAbove || !fitsBelow ? 'above' : 'below'
  }
  // 两边都放不下：选空间大的那边，至少能多看到一点。
  if (!fitsBelow && !fitsAbove && spaceAbove > spaceBelow) {
    side = 'above'
  }

  const available = Math.max(0, side === 'below' ? spaceBelow : spaceAbove)
  const height = Math.min(box.height, available)
  const top =
    side === 'below' ? rect.bottom + gap : Math.max(margin, rect.top - gap - height)

  const width = Math.min(box.width, Math.max(0, viewport.width - margin * 2))
  const preferredLeft = options.align === 'end' ? rect.right - width : rect.left
  const left = clamp(preferredLeft, margin, viewport.width - width - margin)

  return { left, top, side, maxHeight: available }
}
