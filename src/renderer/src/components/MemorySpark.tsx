// 记忆闪光：把这一轮里的规则/结论一键钉进当前 Agent 的私域记忆。
import { useState } from 'react'

import {
  createMemory,
  detectMemoryCandidate,
  loadMemories,
  saveMemories
} from '../lib/memorySpark'
import Icon from './Icon'

export interface MemorySparkProps {
  agentId: string | null
  workspaceId: string | null
  sessionId: string | null
  agentName: string
  content: string
  onChanged: () => void
}

export default function MemorySpark({
  agentId,
  workspaceId,
  sessionId,
  agentName,
  content,
  onChanged
}: MemorySparkProps) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [scope, setScope] = useState<'global' | 'project'>('global')
  const [saved, setSaved] = useState(false)

  if (!agentId) {
    return null
  }

  function begin(): void {
    const candidate = detectMemoryCandidate('', content)
    setText(candidate?.suggestedText ?? content.slice(0, 80))
    setScope(candidate?.defaultScope ?? 'global')
    setOpen(true)
  }

  function commit(): void {
    if (!agentId || text.trim() === '') {
      return
    }
    const item = createMemory({
      agentId,
      text,
      scope,
      workspaceId,
      sourceSessionId: sessionId ?? ''
    })
    saveMemories([item, ...loadMemories()])
    setSaved(true)
    setOpen(false)
    onChanged()
  }

  return (
    <span className="spark">
      <button
        className={`spark-btn${saved ? ' is-saved' : ''}`}
        type="button"
        onClick={begin}
        title={saved ? `已记住（${scope === 'global' ? '全局' : '仅本项目'}）` : `钉入 ${agentName} 的记忆`}
      >
        <Icon name="pin" size={12} />
        {saved ? '已记住' : '钉入记忆'}
      </button>

      {open ? (
        <>
          <span className="spark__mask" role="presentation" onClick={() => setOpen(false)} />
          <div className="spark-panel" role="dialog" aria-label="钉入记忆">
            <textarea
              className="spark-panel__text"
              value={text}
              maxLength={80}
              onChange={(event) => setText(event.target.value)}
              aria-label="记忆内容"
            />
            <div className="spark-panel__row">
              <button
                className={`spark-scope${scope === 'global' ? ' is-on' : ''}`}
                type="button"
                onClick={() => setScope('global')}
              >
                全局
              </button>
              <button
                className={`spark-scope${scope === 'project' ? ' is-on' : ''}`}
                type="button"
                onClick={() => setScope('project')}
              >
                仅本项目
              </button>
              <span className="spark-panel__spacer" />
              <button className="spark-save" type="button" onClick={commit}>
                确认钉入
              </button>
            </div>
          </div>
        </>
      ) : null}
    </span>
  )
}
