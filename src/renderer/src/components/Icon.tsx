// 图标：统一用 lucide-static v1.79.0（ISC）里的那套 24×24 线条图标。
//
// 用到的图标已从图标包里抄进 `assets/icons/`（构建时随包走），
// 没用到的留在工作区 `.lucide-static/`（不入库，见 .gitignore）。
// 每个图标以 `?raw` 导入，只取内部标记，外层由这里统一给出：
// 颜色跟随文字（currentColor），尺寸由 size 控制。
import chevronLeft from '../assets/icons/chevron-left.svg?raw'
import chevronRight from '../assets/icons/chevron-right.svg?raw'
import download from '../assets/icons/download.svg?raw'
import folder from '../assets/icons/folder.svg?raw'
import moon from '../assets/icons/moon.svg?raw'
import panelRight from '../assets/icons/panel-right.svg?raw'
import plus from '../assets/icons/plus.svg?raw'
import search from '../assets/icons/search.svg?raw'
import settings from '../assets/icons/settings.svg?raw'
import sun from '../assets/icons/sun.svg?raw'
import user from '../assets/icons/user.svg?raw'

const PATHS = {
  search,
  plus,
  'chevron-left': chevronLeft,
  'chevron-right': chevronRight,
  'panel-right': panelRight,
  sun,
  moon,
  user,
  folder,
  download,
  settings
} as const

export type IconName = keyof typeof PATHS

export default function Icon({
  name,
  size = 16,
  className = ''
}: {
  name: IconName
  size?: number
  className?: string
}) {
  return (
    <svg
      className={`ico${className === '' ? '' : ` ${className}`}`}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  )
}
