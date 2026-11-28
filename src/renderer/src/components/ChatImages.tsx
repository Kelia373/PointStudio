// components/ChatImages —— 附图缩略图、行内胶囊与全屏灯箱。
//
// 三处共用：输入框托盘、已发提问框、行内 `[Image #N]`。图片本体在
// attachments/，这里只拿 data URL 显示；灯箱支持多图左右切换与 Esc 关闭。
import { useEffect, useState } from 'react'

import type { MessageImageDto } from '../../../shared/types/ipc.ts'
import { parseTextWithImageTokens, type MessagePart } from '../lib/imageTokens'
import Icon from './Icon'

export interface LightboxState {
  images: MessageImageDto[]
  /** 0 起的下标。 */
  start: number
}

/** 灯箱：全屏遮罩 + 居中高清图，Esc / 点遮罩关闭，左右方向键翻页。 */
export function ImageLightbox({
  state,
  onClose
}: {
  state: LightboxState | null
  onClose: () => void
}) {
  const [index, setIndex] = useState(state?.start ?? 0)
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    setIndex(state?.start ?? 0)
  }, [state])

  useEffect(() => {
    if (state === null) {
      return
    }
    let cancelled = false
    for (const image of state.images) {
      if (urls[image.id] !== undefined) {
        continue
      }
      void window.pointstudio.attachments.readDataUrl(image.id).then((result) => {
        if (!cancelled && result.ok) {
          setUrls((current) => ({ ...current, [image.id]: result.value }))
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [state, urls])

  useEffect(() => {
    if (state === null) {
      return
    }
    const total = state.images.length
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
      if (event.key === 'ArrowLeft') {
        setIndex((current) => (current - 1 + total) % total)
      }
      if (event.key === 'ArrowRight') {
        setIndex((current) => (current + 1) % total)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, onClose])

  if (state === null || state.images.length === 0) {
    return null
  }
  const current = state.images[Math.min(index, state.images.length - 1)]
  const src = urls[current.id]

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="查看图片">
      <span className="lightbox__mask" role="presentation" onClick={onClose} />
      <div className="lightbox__head">
        <span className="lightbox__title">
          图片 #{index + 1} · {current.name}
        </span>
        <button className="lightbox__close" type="button" onClick={onClose} title="关闭 Esc">
          关闭 Esc
        </button>
      </div>
      {state.images.length > 1 ? (
        <button
          className="lightbox__nav lightbox__nav--prev"
          type="button"
          aria-label="上一张"
          onClick={() => setIndex((value) => (value - 1 + state.images.length) % state.images.length)}
        >
          ‹
        </button>
      ) : null}
      {src !== undefined ? (
        <img className="lightbox__img" src={src} alt={current.name} />
      ) : (
        <span className="lightbox__loading">读取中…</span>
      )}
      {state.images.length > 1 ? (
        <button
          className="lightbox__nav lightbox__nav--next"
          type="button"
          aria-label="下一张"
          onClick={() => setIndex((value) => (value + 1) % state.images.length)}
        >
          ›
        </button>
      ) : null}
    </div>
  )
}

/** 缩略图条：左下 #N 角标，点击开灯箱。 */
export function ImageThumbs({
  images,
  onOpen
}: {
  images: MessageImageDto[]
  onOpen: (start: number) => void
}) {
  const [urls, setUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    for (const image of images) {
      if (urls[image.id] !== undefined) {
        continue
      }
      void window.pointstudio.attachments.readDataUrl(image.id).then((result) => {
        if (!cancelled && result.ok) {
          setUrls((current) => ({ ...current, [image.id]: result.value }))
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [images, urls])

  return (
    <div className="msg__thumbs">
      {images.map((image, index) => (
        <button
          key={image.id}
          className="thumb"
          type="button"
          title={image.name}
          onClick={() => onOpen(index)}
        >
          {urls[image.id] !== undefined ? (
            <img className="thumb__img" src={urls[image.id]} alt={image.name} />
          ) : (
            <span className="thumb__pending" />
          )}
          <span className="thumb__badge">#{index + 1}</span>
        </button>
      ))}
    </div>
  )
}

/** 文本里混着 `[Image #N]` 时：文字照常、标记渲染成可点胶囊。 */
export function InlineImageText({
  text,
  imageCount,
  onOpen
}: {
  text: string
  imageCount: number
  onOpen: (start: number) => void
}) {
  const parts: MessagePart[] = parseTextWithImageTokens(text)
  return (
    <span className="msg__inline-text">
      {parts.map((part, index) =>
        part.type === 'text' ? (
          <span key={index}>{part.value}</span>
        ) : (
          <button
            key={index}
            className="image-chip"
            type="button"
            aria-label={`查看图片 #${part.slot}`}
            onClick={() => onOpen(Math.max(0, Math.min(part.slot - 1, imageCount - 1)))}
          >
            <Icon name="folder" size={11} />
            图片 #{part.slot}
          </button>
        )
      )}
    </span>
  )
}
