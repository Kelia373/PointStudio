// 双轨回答：同一块地方，结论与推理过程二选一，点一下就换镜头。
//
// 只在模型自己写了「结论：」这类标记时才折叠。没有标记的长答案整篇照常渲染——
// 以前拿末段当结论，会把一整篇答案切成「91 步原始 Markdown + 一小截结论」，
// 用户反而看不到全文。
import { useState } from 'react'

import {
  hasConclusionMark,
  shouldCollapse,
  splitProcessAndConclusion,
  type LensMode
} from '../lib/timelineLens'
import MarkdownBody from './MarkdownBody'

export interface DualTrackProps {
  content: string
  /** 流式吐字时不折叠，避免文字跳动。 */
  streaming?: boolean
}

export default function DualTrack({ content, streaming = false }: DualTrackProps) {
  const [mode, setMode] = useState<LensMode>('conclusion')
  const split = splitProcessAndConclusion(content)
  const lensable = hasConclusionMark(content) && shouldCollapse(split, content)

  if (streaming || !lensable) {
    return (
      <div className="msg__body">
        <MarkdownBody content={content} />
        {streaming ? <span className="msg__caret" /> : null}
      </div>
    )
  }

  return (
    <div className="dual-track">
      <div className="dual-track__tabs">
        <button
          className={`dual-track__tab${mode === 'conclusion' ? ' is-on' : ''}`}
          type="button"
          onClick={() => setMode('conclusion')}
        >
          结论
        </button>
        <button
          className={`dual-track__tab${mode === 'process' ? ' is-on' : ''}`}
          type="button"
          onClick={() => setMode('process')}
        >
          过程 · {split.process.length} 步
        </button>
      </div>

      {mode === 'conclusion' ? (
        <div className="msg__body dual-track__body">
          <MarkdownBody content={split.conclusion} />
        </div>
      ) : (
        <ol className="dual-track__steps">
          {split.process.map((step, index) => (
            <li key={`${index}-${step.slice(0, 8)}`}>
              <MarkdownBody content={step} />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
