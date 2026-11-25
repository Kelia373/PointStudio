// 行内二次确认按钮：第一次点变红问一句，3 秒没跟进就自己复位。
//
// 为什么不做成弹窗：破坏性操作在列表里高频出现，弹窗会打断节奏；
// 但「点一下就没了」又太便宜。这个折中既不打断，也不会误删。
import { useEffect, useState } from 'react'

import Icon from './Icon'

export default function ConfirmButton({
  label,
  confirmLabel = '确认?',
  title,
  ariaLabel,
  className = '',
  onConfirm,
  children
}: {
  /** 首次显示的文字；给了 children 就用 children 显示 */
  label?: string
  confirmLabel?: string
  title?: string
  ariaLabel?: string
  className?: string
  onConfirm: () => void
  children?: React.ReactNode
}) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (!armed) {
      return
    }
    const timer = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(timer)
  }, [armed])

  return (
    <button
      className={`${className}${armed ? ' is-confirm' : ''}`}
      type="button"
      title={armed ? '再点一次确认' : title}
      aria-label={ariaLabel ?? title}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
          return
        }
        setArmed(true)
      }}
    >
      {armed ? confirmLabel : (children ?? label)}
    </button>
  )
}

export function CloseIconButton({
  onClick,
  title = '关闭',
  className = ''
}: {
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button className={className} type="button" aria-label={title} title={title} onClick={onClick}>
      <Icon name="x" size={12} />
    </button>
  )
}
