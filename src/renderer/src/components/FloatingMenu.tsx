// components/FloatingMenu —— 固定定位菜单的统一外壳。
//
// 以前每个菜单自己算 left/top，谁漏了夹取就飞出窗口。这里统一交给
// useAnchoredPanel：下方放不下自动翻到上方，左右越界自动夹回视口。
import type { ReactNode } from 'react'

import { useAnchoredPanel } from '../lib/useAnchoredPanel'
import type { AnchorPoint, AnchorRect } from '../lib/floatingPlacement'

export interface FloatingMenuProps {
  /** 跟着鼠标点的菜单传坐标，跟着按钮的菜单传矩形。 */
  anchor: AnchorPoint | AnchorRect | null
  className: string
  children: ReactNode
  role?: string
  ariaLabel?: string
  align?: 'start' | 'end'
  gap?: number
  margin?: number
}

export default function FloatingMenu({
  anchor,
  className,
  children,
  role = 'menu',
  ariaLabel,
  align,
  gap,
  margin
}: FloatingMenuProps) {
  const { ref, style } = useAnchoredPanel<HTMLDivElement>(anchor, { align, gap, margin })
  return (
    <div ref={ref} className={className} role={role} aria-label={ariaLabel} style={style}>
      {children}
    </div>
  )
}
