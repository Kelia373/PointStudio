// 输入区：三态（发送 / 流式中 / 停止）+ 高度自适应 + Enter 发送。
// 纯展示 + 转发，不持有发送逻辑（submit 在 ChatPanel）。
import { useEffect, useRef } from 'react'

export default function Composer({
  draft,
  busy,
  canSend,
  onDraftChange,
  onSend,
  onStop,
  onPlan
}: {
  draft: string
  busy: boolean
  canSend: boolean
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onPlan: () => void
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 高度自适应：内容长高就长高，但不超过 CSS 的 max-height。
  useEffect(() => {
    const node = inputRef.current
    if (!node) {
      return
    }
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [draft])

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) {
          onSend()
        }
      }}
    >
      <div className="composer__box">
        <textarea
          ref={inputRef}
          className="composer__input"
          value={draft}
          rows={1}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (!busy) {
                onSend()
              }
            }
          }}
        />
        <div className="composer__bar">
          <span className="composer__spacer" />
          <button
            className="msg__act"
            type="button"
            onClick={onPlan}
            disabled={busy || draft.trim() === ''}
            title="把这句话交给 Agent 生成执行计划"
          >
            🧭 计划
          </button>
          {busy ? (
            <button className="btn-stop" type="button" onClick={onStop}>
              停止
            </button>
          ) : (
            <button className="btn-send" type="submit" disabled={!canSend}>
              发送
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
