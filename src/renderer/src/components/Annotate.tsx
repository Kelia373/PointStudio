// 标注模式：把「说不清哪里不对」变成「点一下 + 写一句」。
//
// 开启后整页进入拾取状态：鼠标悬停高亮元素，点一下选中它，选一个标签写一句备注，
// 存进列表；底部条可以一键复制成文本，粘给我就能直接定位。
//
// 这一层纯前端、不碰主进程：标注只对当前界面有意义，不需要落库。
// 存储用 localStorage，刷新后还在（同一台机器）。
import { useCallback, useEffect, useRef, useState } from 'react'

import { ANNOTATION_TAGS, toPlainText, type AnnotationItem } from '../lib/annotations'
import { copyToClipboard } from '../lib/clipboard'

const TAGS = ANNOTATION_TAGS
const STORAGE_KEY = 'pointstudio.annotations'

function readStored(): AnnotationItem[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as AnnotationItem[]) : []
  } catch {
    return []
  }
}

/** 把元素描述成人能对上号的样子。太长的文本截断，避免复制出来一屏。 */
function describe(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase()
  const classes = typeof element.className === 'string' ? element.className : ''
  const cls = classes
    .split(/\s+/)
    .filter((name) => name !== '')
    .slice(0, 2)
    .join('.')
  const text = (element.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 24)
  const head = `<${tag}${cls === '' ? '' : `.${cls}`}>`
  return text === '' ? head : `${head} “${text}”`
}

export default function Annotate({
  enabled,
  onClose
}: {
  enabled: boolean
  onClose: () => void
}) {
  const [items, setItems] = useState<AnnotationItem[]>(readStored)
  const [pending, setPending] = useState<{ target: string; x: number; y: number } | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [tag, setTag] = useState<string>(TAGS[0])
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState('')
  const pendingRef = useRef<typeof pending>(null)
  pendingRef.current = pending

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  }, [items])

  // 拾取状态下的整页监听：捕获阶段拦掉点击，避免误触发界面自己的按钮。
  useEffect(() => {
    if (!enabled) {
      setHover(null)
      setPending(null)
      return
    }

    // 标注模式开启后会拦截整页点击；但开关本身必须放行，
    // 否则「打开标注」之后就再也点不到关闭按钮了（只能刷新）。
    function block(event: Event): boolean {
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return false
      }
      return target.closest('.annot-ui') !== null || target.closest('[data-annot-skip]') !== null
    }

    function onMove(event: PointerEvent): void {
      if (block(event) || pendingRef.current !== null) {
        setHover(null)
        return
      }
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      const rect = target.getBoundingClientRect()
      setHover({ x: rect.left, y: rect.top, w: rect.width, h: rect.height })
    }

    function onClick(event: MouseEvent): void {
      if (block(event)) {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }
      setPending({ target: describe(target), x: event.clientX, y: event.clientY })
      setNote('')
      setTag(TAGS[0])
    }

    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('click', onClick, true)
    return () => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('click', onClick, true)
    }
  }, [enabled])

  const save = useCallback(() => {
    if (!pending) {
      return
    }
    setItems((prev) => [
      ...prev,
      { id: crypto.randomUUID(), target: pending.target, tag, note: note.trim() }
    ])
    setPending(null)
    setNote('')
  }, [pending, tag, note])

  const copyAll = useCallback(async (): Promise<void> => {
    const text = toPlainText(items)
    if (text === '') {
      return
    }
    const ok = await copyToClipboard(text)
    setCopied(ok ? '已复制' : '复制失败')
    window.setTimeout(() => setCopied(''), 1500)
  }, [items])

  if (!enabled) {
    return null
  }

  return (
    <div className="annot-ui">
      {hover ? (
        <div
          className="annot-outline"
          style={{ left: hover.x, top: hover.y, width: hover.w, height: hover.h }}
        />
      ) : null}

      {pending ? (
        <div
          className="annot-pop"
          style={{
            left: Math.min(pending.x, window.innerWidth - 320),
            top: Math.min(pending.y + 12, window.innerHeight - 240)
          }}
        >
          <div className="annot-pop__target" title={pending.target}>
            {pending.target}
          </div>
          <div className="annot-pop__tags">
            {TAGS.map((option) => (
              <button
                key={option}
                className={`annot-chip${tag === option ? ' annot-chip--on' : ''}`}
                type="button"
                onClick={() => setTag(option)}
              >
                {option}
              </button>
            ))}
          </div>
          <textarea
            className="annot-pop__note"
            value={note}
            rows={2}
            placeholder="补一句：想怎么改？（可留空）"
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                save()
              }
            }}
          />
          <div className="annot-pop__actions">
            <button className="annot-btn" type="button" onClick={() => setPending(null)}>
              取消
            </button>
            <button className="annot-btn annot-btn--main" type="button" onClick={save}>
              保存
            </button>
          </div>
        </div>
      ) : null}

      <div className="annot-bar">
        <span className="annot-bar__count">标注 · {items.length} 条</span>
        <button className="annot-btn" type="button" onClick={() => void copyAll()} disabled={items.length === 0}>
          {copied === '' ? '复制全部' : copied}
        </button>
        <button
          className="annot-btn"
          type="button"
          onClick={() => setItems([])}
          disabled={items.length === 0}
        >
          清空
        </button>
        <button className="annot-btn" type="button" onClick={onClose}>
          退出标注
        </button>
      </div>
    </div>
  )
}

export type { AnnotationItem }
