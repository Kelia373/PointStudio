// 侧栏四段：搜索 / 关键功能 / Agent Beach / Project。
// 收起态不再做图标轨，整列由 .shell--collapsed 收掉。
import { useEffect, useMemo, useRef, useState } from 'react'

import type { ConversationDto } from '../../../shared/types/ipc.ts'
import { filterConversations } from '../lib/filterConversations'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

type FeatureKey = 'board' | 'prompts'

// 目前只有两个真正预留的功能位；更多里放未固定项。
const FEATURES: { key: FeatureKey; label: string; icon: 'compass' | 'pen-line'; soon: boolean }[] = [
  { key: 'board', label: '任务看板', icon: 'compass', soon: true },
  { key: 'prompts', label: '提示词管理', icon: 'pen-line', soon: true }
]

export default function Sidebar({
  conversations,
  assistants,
  activeId,
  collapsed,
  onToggleCollapse,
  onSelect,
  onCreate,
  onRemove,
  onOpenAssistants,
  onOpenSettings
}: {
  conversations: ConversationDto[]
  assistants: { id: string; name: string }[]
  activeId: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onSelect: (id: string) => void
  onCreate: () => void
  onRemove: (id: string) => void
  onOpenAssistants: () => void
  onOpenSettings: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  // 固定到侧栏的功能；未固定的收进「更多」。
  const [pinned, setPinned] = useState<Record<FeatureKey, boolean>>({ board: true, prompts: false })
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

  const features = FEATURES.filter((item) => pinned[item.key] || moreOpen)

  return (
    <aside className="side">
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

      <section className="side__section">
        <ul className="side__plain">
          {features.map((item) => (
            <li className="side__feat-row" key={item.key}>
              <button className="side__feat" type="button" title={item.soon ? `${item.label}（占位）` : item.label}>
                <Icon name={item.icon} className="side__feat-icon" />
                <span className="side__feat-label">{item.label}</span>
                {item.soon ? <em className="side__soon">待接</em> : null}
              </button>
              <button
                className="side__pin"
                type="button"
                aria-pressed={pinned[item.key]}
                title={pinned[item.key] ? '取消固定' : '固定到侧栏'}
                aria-label={pinned[item.key] ? '取消固定' : '固定到侧栏'}
                onClick={() => setPinned((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
              >
                <Icon name="pin" size={13} />
              </button>
            </li>
          ))}
          <li>
            <button
              className="side__more"
              type="button"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((value) => !value)}
            >
              <Icon name="arrow-down" className={`side__more-icon${moreOpen ? ' is-open' : ''}`} size={13} />
              <span>{moreOpen ? '收起更多' : '更多'}</span>
            </button>
          </li>
        </ul>
      </section>

      <section className="side__section">
        <div className="side__head">
          Agent Beach
          <span className="side__head-note">{assistants.length}</span>
        </div>
        <ul className="side__plain">
          {assistants.length === 0 ? (
            <li className="side__empty">还没有 Agent</li>
          ) : (
            assistants.map((assistant) => (
              <li key={assistant.id}>
                <button className="side__row" type="button" onClick={onOpenAssistants} title={assistant.name}>
                  <Icon name="user" className="side__row-icon" />
                  <span>{assistant.name}</span>
                </button>
              </li>
            ))
          )}
          <li>
            <button className="side__row" type="button" onClick={onOpenAssistants}>
              <Icon name="settings" className="side__row-icon" />
              <span>调整 Agent</span>
            </button>
          </li>
        </ul>
      </section>

      <section className="side__section side__section--grow">
        <div className="side__head">
          Project
          <span className="side__head-note">未归类</span>
        </div>
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
              </div>
            </li>
          ))}
          {visible.length === 0 && conversations.length > 0 ? (
            <li className="side__empty">没有匹配的会话</li>
          ) : null}
          {conversations.length === 0 ? <li className="side__empty">还没有会话</li> : null}
        </ul>
      </section>

      <div className="side__foot">
        <button className="side__act" type="button" onClick={onOpenSettings} title="设置">
          <Icon name="settings" className="side__act-icon" />
          <span className="side__act-label">设置</span>
        </button>
      </div>
    </aside>
  )
}
