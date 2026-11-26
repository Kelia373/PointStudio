// 幽灵记忆唤醒条：输入框上方一行，告诉你这一轮 AI 会带着哪些私域记忆。
import type { AgentMemoryItem } from '../lib/memorySpark'

export interface MemoryWakeBarProps {
  agentName: string | null
  memories: AgentMemoryItem[]
  onManage: () => void
  onDismiss: () => void
}

export default function MemoryWakeBar({ agentName, memories, onManage, onDismiss }: MemoryWakeBarProps) {
  if (!agentName || memories.length === 0) {
    return null
  }

  const preview = memories.slice(0, 2).map((item) => item.text).join(' · ')

  return (
    <div className="memory-wake-bar">
      <span className="memory-wake-bar__mark" aria-hidden="true">
        ✦
      </span>
      <span className="memory-wake-bar__text">
        已唤醒 {agentName} 的 {memories.length} 条私域记忆：{preview}
      </span>
      <button className="memory-wake-bar__act" type="button" onClick={onManage}>
        管理
      </button>
      <button className="memory-wake-bar__act" type="button" onClick={onDismiss}>
        本轮忽略 ×
      </button>
    </div>
  )
}
