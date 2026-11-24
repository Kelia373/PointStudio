// 侧栏：品牌行 + 会话列表 + 功能区。
// 收起态只留图标轨（64px），语义不变——按钮仍有 aria-label 与 title。
import type { ConversationDto } from '../../../shared/types/ipc.ts'

export default function Sidebar({
  conversations,
  activeId,
  collapsed,
  onToggleCollapse,
  onSelect,
  onCreate,
  onRemove,
  onOpenAssistants,
  onOpenWorkspace,
  onOpenSettings,
  onExport
}: {
  conversations: ConversationDto[]
  activeId: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onSelect: (id: string) => void
  onCreate: () => void
  onRemove: (id: string) => void
  onOpenAssistants: () => void
  onOpenWorkspace: () => void
  onOpenSettings: () => void
  onExport: () => void
}) {
  return (
    <aside className={`side${collapsed ? ' side--rail' : ''}`}>
      <div className="side__brand">
        <span className="side__logo" aria-hidden="true">
          P
        </span>
        <span className="side__name">PointStudio</span>
        <button
          className="side__collapse"
          type="button"
          onClick={onToggleCollapse}
          title={collapsed ? '展开侧栏' : '收起侧栏'}
          aria-label={collapsed ? '展开侧栏' : '收起侧栏'}
        >
          {collapsed ? '»' : '«'}
        </button>
      </div>

      <button
        className="side__new"
        type="button"
        onClick={onCreate}
        title="新建会话"
        aria-label="新建会话"
      >
        <span className="side__new-icon" aria-hidden="true">
          ＋
        </span>
        <span className="side__new-label">新建</span>
      </button>

      <ul className="side__list">
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <div
              className={`side__item${conversation.id === activeId ? ' side__item--active' : ''}`}
            >
              <button
                className="side__item-main"
                type="button"
                onClick={() => onSelect(conversation.id)}
                title={conversation.title}
              >
                {conversation.title}
              </button>
              <button
                className="side__item-remove"
                type="button"
                aria-label="删除会话"
                title="删除会话"
                onClick={() => onRemove(conversation.id)}
              >
                ×
              </button>
            </div>
          </li>
        ))}
        {conversations.length === 0 ? <li className="side__empty">还没有会话</li> : null}
      </ul>

      <div className="side__foot">
        <button
          className="side__act"
          type="button"
          onClick={onOpenAssistants}
          title="助手管理"
        >
          <span className="side__act-icon">👤</span>
          <span className="side__act-label">助手管理</span>
        </button>
        <button className="side__act" type="button" onClick={onOpenWorkspace} title="工作区">
          <span className="side__act-icon">📁</span>
          <span className="side__act-label">工作区</span>
        </button>
        <button className="side__act" type="button" onClick={onExport} title="导出 Markdown">
          <span className="side__act-icon">⤓</span>
          <span className="side__act-label">导出</span>
        </button>
        <button className="side__act" type="button" onClick={onOpenSettings} title="设置">
          <span className="side__act-icon">⚙</span>
          <span className="side__act-label">设置</span>
        </button>
      </div>
    </aside>
  )
}
