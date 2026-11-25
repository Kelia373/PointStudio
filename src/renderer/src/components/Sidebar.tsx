// 侧栏：品牌行 + 搜索 + 会话列表 + 功能区。
// 收起态只留图标轨（64px）：品牌行改成上下排布（logo 在上、折叠键在下），
// 搜索变成一个放大镜按钮，点它展开侧栏并聚焦输入框。
import { useEffect, useMemo, useRef, useState } from 'react'

import type { ConversationDto } from '../../../shared/types/ipc.ts'
import { filterConversations } from '../lib/filterConversations'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

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
  const [keyword, setKeyword] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const visible = useMemo(() => filterConversations(conversations, keyword), [conversations, keyword])

  // Ctrl/⌘ + F 聚焦搜索：界面上那个 ⌘F 标记得是真的。
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        if (collapsed) {
          onToggleCollapse()
        }
        window.setTimeout(() => inputRef.current?.focus(), 0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [collapsed, onToggleCollapse])

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
          <Icon name={collapsed ? 'chevron-right' : 'chevron-left'} />
        </button>
      </div>

      {collapsed ? (
        <div className="side__rail-tools">
          <button
            className="side__rail-btn"
            type="button"
            onClick={onToggleCollapse}
            title="搜索会话"
            aria-label="搜索会话"
          >
            <Icon name="search" />
          </button>
          <button
            className="side__rail-btn"
            type="button"
            onClick={onCreate}
            title="新建会话"
            aria-label="新建会话"
          >
            <Icon name="plus" />
          </button>
        </div>
      ) : (
        <div className="side__search">
          <Icon name="search" className="side__search-icon" />
          <input
            ref={inputRef}
            className="side__search-input"
            value={keyword}
            placeholder="搜索会话"
            aria-label="搜索会话"
            onChange={(event) => setKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setKeyword('')
                event.currentTarget.blur()
              }
            }}
          />
          <span className="side__key">⌘F</span>
          <button
            className="side__search-add"
            type="button"
            onClick={onCreate}
            title="新建会话"
            aria-label="新建会话"
          >
            <Icon name="plus" />
          </button>
        </div>
      )}

      <ul className="side__list">
        {visible.map((conversation) => (
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
              <ConfirmButton
                className="side__item-remove"
                ariaLabel="删除会话"
                title="删除会话"
                confirmLabel="删?"
                onConfirm={() => onRemove(conversation.id)}
              >
                <Icon name="x" size={12} />
              </ConfirmButton>
              <button
                className="side__item-badge"
                type="button"
                onClick={() => onSelect(conversation.id)}
                title={conversation.title}
                aria-label={conversation.title}
              >
                {conversation.title.trim().slice(0, 1) || '对'}
              </button>
            </div>
          </li>
        ))}
        {visible.length === 0 && conversations.length > 0 ? (
          <li className="side__empty">没有匹配的会话</li>
        ) : null}
        {conversations.length === 0 ? <li className="side__empty">还没有会话</li> : null}
      </ul>

      <div className="side__foot">
        <button
          className="side__act"
          type="button"
          onClick={onOpenAssistants}
          title="助手管理"
        >
          <Icon name="user" className="side__act-icon" />
          <span className="side__act-label">助手管理</span>
        </button>
        <button className="side__act" type="button" onClick={onOpenWorkspace} title="工作区">
          <Icon name="folder" className="side__act-icon" />
          <span className="side__act-label">工作区</span>
        </button>
        <button className="side__act" type="button" onClick={onExport} title="导出 Markdown">
          <Icon name="download" className="side__act-icon" />
          <span className="side__act-label">导出</span>
        </button>
        <button className="side__act" type="button" onClick={onOpenSettings} title="设置">
          <Icon name="settings" className="side__act-icon" />
          <span className="side__act-label">设置</span>
        </button>
      </div>
    </aside>
  )
}
