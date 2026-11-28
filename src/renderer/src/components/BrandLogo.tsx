// 品牌图标 D1（瑞士实心 P· 纯白单色）。
//
// tile：256 视口的圆角瓦片，带渐变底与高光点，用于应用图标/侧栏/空状态；
// mark：24 视口纯 currentColor 字标，用于助手消息头/状态栏。
// 渐变 id 用 useId 隔离：同页多个 tile 实例不会互相覆盖。
import { useId } from 'react'

export interface BrandLogoProps {
  variant?: 'tile' | 'mark'
  size?: number
  className?: string
}

export default function BrandLogo({
  variant = 'tile',
  size = 24,
  className = ''
}: BrandLogoProps) {
  const rawId = useId()
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '')
  const classes = `brand-logo${className === '' ? '' : ` ${className}`}`

  if (variant === 'mark') {
    return (
      <svg
        className={classes}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M4.5 3.5 H12 C16 3.5 18.5 6 18.5 9.6 C18.5 13.2 16 15.7 12 15.7 H8 V20.5 H4.5 V3.5 Z M8 6.8 V12.4 H11.7 C13.7 12.4 15 11.2 15 9.6 C15 8 13.7 6.8 11.7 6.8 H8 Z"
          fill="currentColor"
        />
        <circle cx="16.5" cy="18" r="2.6" fill="currentColor" />
      </svg>
    )
  }

  const backgroundId = `ps-bg-${uid}`
  const rimId = `ps-rim-${uid}`
  const foregroundId = `ps-fg-${uid}`

  return (
    <svg
      className={classes}
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={backgroundId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1a1a20" />
          <stop offset="100%" stopColor="#09090b" />
        </linearGradient>
        <linearGradient id={rimId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(255,255,255,0.28)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.06)" />
        </linearGradient>
        <linearGradient id={foregroundId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#dcdce3" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="256" height="256" rx="58" fill={`url(#${backgroundId})`} />
      <rect
        x="2"
        y="2"
        width="252"
        height="252"
        rx="56"
        fill="none"
        stroke={`url(#${rimId})`}
        strokeWidth="3"
      />
      <circle cx="166" cy="174" r="32" fill="#ffffff" opacity="0.12" />
      <path
        d="M68 58 H134 C168 58 190 79 190 110 C190 141 168 162 134 162 H98 V198 H68 V58 Z M98 86 V134 H131 C148 134 159 124 159 110 C159 96 148 86 131 86 H98 Z"
        fill={`url(#${foregroundId})`}
      />
      <circle cx="166" cy="174" r="22" fill={`url(#${foregroundId})`} />
    </svg>
  )
}
