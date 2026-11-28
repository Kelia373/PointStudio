// ThinkingBlock —— 推理模型的思考过程折叠卡。
//
// 流式思考且在正文未开始时默认展开；正文到达后自动收起。
// 用户手动点开/收起后，本次流式期间不再被自动状态覆盖。
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'

export default function ThinkingBlock({
  reasoning,
  streamingReasoning = false,
  durationMs
}: {
  reasoning: string
  streamingReasoning?: boolean
  durationMs?: number
}) {
  const [open, setOpen] = useState(streamingReasoning)
  const manual = useRef(false)

  useEffect(() => {
    if (manual.current) {
      return
    }
    setOpen(streamingReasoning)
  }, [streamingReasoning])

  if (reasoning.trim() === '') {
    return null
  }

  const seconds =
    typeof durationMs === 'number' && durationMs >= 0
      ? `${(durationMs / 1000).toFixed(1)}s`
      : null

  return (
    <div className={`thinking${open ? ' is-open' : ''}`}>
      <button
        className="thinking__head"
        type="button"
        aria-expanded={open}
        onClick={() => {
          manual.current = true
          setOpen((value) => !value)
        }}
      >
        <Icon
          name="arrow-down"
          className={`thinking__caret${open ? ' is-open' : ''}`}
          size={12}
        />
        <span className={`thinking__dot${streamingReasoning ? ' is-live' : ''}`} />
        <span className="thinking__title">
          {streamingReasoning ? '思考中…' : '已深度思考'}
        </span>
        {!streamingReasoning && seconds !== null ? (
          <span className="thinking__meta">· {seconds}</span>
        ) : null}
      </button>
      {open ? <div className="thinking__body">{reasoning}</div> : null}
    </div>
  )
}
