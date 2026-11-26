// 全局时间线：按天聚拢的横向刻度，点一下跳回那天的会话。
import { useState } from 'react'

import { groupTimelineByDay } from '../lib/timelineLens'
import type { ConversationDto } from '../../../shared/types/ipc.ts'

export interface TimelineRailProps {
  conversations: ConversationDto[]
  activeId: string | null
  onSelect: (id: string) => void
}

export default function TimelineRail({ conversations, activeId, onSelect }: TimelineRailProps) {
  const [open, setOpen] = useState(true)
  const groups = groupTimelineByDay(
    conversations.map((item) => ({ id: item.id, title: item.title, at: item.updatedAt }))
  )

  if (groups.length === 0) {
    return null
  }

  return (
    <div className="timeline-rail">
      <button
        className="timeline-rail__head"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        时间线 · {groups.length} 天
      </button>

      {open
        ? groups.map((group) => (
            <div className="timeline-rail__day" key={group.day}>
              <span className="timeline-rail__date">{group.day.slice(5)}</span>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`timeline-rail__item${item.id === activeId ? ' is-active' : ''}`}
                  type="button"
                  title={item.title}
                  onClick={() => onSelect(item.id)}
                >
                  {item.title}
                </button>
              ))}
            </div>
          ))
        : null}
    </div>
  )
}
