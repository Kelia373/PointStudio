// 左侧会话列表。只负责显示与转发事件，会话数据由父组件持有。
import type { ConversationDto } from '../../../shared/types/ipc.ts'

export default function ConversationList({
  conversations,
  activeId,
  onSelect,
  onCreate,
  onRemove
}: {
  conversations: ConversationDto[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onRemove: (id: string) => void
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar__head">
        <span className="sidebar__title">会话</span>
        <button className="sidebar__new" type="button" onClick={onCreate}>
          ＋ 新建
        </button>
      </div>

      <ul className="sidebar__list">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <div
              className={`sidebar__item${conversation.id === activeId ? ' sidebar__item--active' : ''}`}
            >
              <button
                className="sidebar__item-main"
                type="button"
                onClick={() => onSelect(conversation.id)}
                title={conversation.title}
              >
                {conversation.title}
              </button>
              <button
                className="sidebar__item-remove"
                type="button"
                aria-label="删除会话"
                onClick={() => onRemove(conversation.id)}
              >
                ×
              </button>
            </div>
          </li>
        ))}
        {conversations.length === 0 ? <li className="sidebar__empty">还没有会话</li> : null}
      </ul>
    </aside>
  )
}
