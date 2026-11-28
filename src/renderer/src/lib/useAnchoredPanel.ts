// lib/useAnchoredPanel —— 把「量尺寸 + 算位置」包成钩子，固定定位的浮层统一走它。
//
// 关键约定：首帧先量再显示。没量到之前给 visibility: hidden，避免浮层先在
// 错误位置闪一下再跳。
import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'

import {
  placeFloatingBox,
  type AnchorPoint,
  type AnchorRect,
  type PlacementOptions
} from './floatingPlacement'

export interface AnchoredPanelResult<T extends HTMLElement> {
  ref: React.RefObject<T | null>
  /** 直接铺到 style 上；首帧还没量好时是 visibility: hidden。 */
  style: CSSProperties
}

export function useAnchoredPanel<T extends HTMLElement = HTMLDivElement>(
  anchor: AnchorRect | AnchorPoint | null,
  options: PlacementOptions & { width?: number } = {}
): AnchoredPanelResult<T> {
  const ref = useRef<T>(null)
  const [style, setStyle] = useState<CSSProperties | null>(null)
  const { width, gap, margin, align, prefer } = options

  useLayoutEffect(() => {
    if (anchor === null) {
      setStyle(null)
      return
    }
    const panel = ref.current
    if (panel === null) {
      return
    }

    // 先解除高度上限量一次自然高度，再交给 placement 决定要不要缩。
    const previousMax = panel.style.maxHeight
    panel.style.maxHeight = 'none'
    const naturalHeight = panel.offsetHeight
    panel.style.maxHeight = previousMax

    const placed = placeFloatingBox(
      anchor,
      { width: width ?? panel.offsetWidth, height: naturalHeight },
      { width: window.innerWidth, height: window.innerHeight },
      { ...(gap === undefined ? {} : { gap }), ...(margin === undefined ? {} : { margin }), ...(align === undefined ? {} : { align }), ...(prefer === undefined ? {} : { prefer }) }
    )

    // 内容放得下就别加滚动/裁切：带悬浮子菜单的菜单一旦 overflow:auto 会把子菜单剪掉。
    const needsScroll = placed.maxHeight < naturalHeight

    setStyle((current) => {
      if (
        current !== null &&
        current.left === placed.left &&
        current.top === placed.top &&
        current.maxHeight === placed.maxHeight &&
        current.width === width
      ) {
        return current
      }
      return {
        left: placed.left,
        top: placed.top,
        width,
        maxHeight: placed.maxHeight,
        overflowY: needsScroll ? 'auto' : 'visible'
      }
    })
    // anchor 每次渲染都是新对象，故意只依赖它的坐标与外部选项。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorKey(anchor), width, gap, margin, align, prefer])

  return {
    ref,
    style: style ?? { visibility: 'hidden', ...(width === undefined ? {} : { width }) }
  }
}

function anchorKey(anchor: AnchorRect | AnchorPoint | null): string {
  if (anchor === null) {
    return ''
  }
  return 'x' in anchor ? `p:${anchor.x},${anchor.y}` : `r:${anchor.top},${anchor.bottom},${anchor.left},${anchor.right}`
}
