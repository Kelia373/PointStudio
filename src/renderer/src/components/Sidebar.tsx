// 侧栏四段：搜索 / 关键功能 / Agent Bench（驻场工位）/ Project。
// 收起态不再做图标轨，整列由 .shell--collapsed 收掉。
import { useEffect, useMemo, useRef, useState } from 'react'

import type { ConversationDto } from '../../../shared/types/ipc.ts'
import { computeAgentBenchStatus, filterSessionsByAxis } from '../lib/dispatchFilter'
import { CHAT_PAGE, nextActivePage } from '../lib/pageNav'
import { registry } from '../runtime/registry'
import { Overridable, Slot, useRegistryVersion } from '../runtime/SlotRenderer'
import Icon from './Icon'
import SessionItem from './SessionItem'

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
  onOpenSettings,
  onOpenWorkspace,
  activePage,
  onNavigate,
  inflightId
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
  /** 打开工作区面板：导入文件供检索引用。 */
  onOpenWorkspace: () => void
  /** 当前主舞台页面，用于高亮功能项。 */
  activePage: string
  onNavigate: (pageId: string) => void
  /** 正在流式输出的会话 id，用于驻场状态。 */
  inflightId: string | null
}) {
  const [keyword, setKeyword] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  // 固定到侧栏的功能；未固定的收进「更多」。缺省值来自页面自身的 defaultPinned。
  const [pinned, setPinned] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  // 双轴：点 Agent 行 = 只看它跨项目的记录；点项目 = 看该项目下所有 Agent。
  const [agentAxis, setAgentAxis] = useState<string | null>(null)
  const [projectAxis, setProjectAxis] = useState<string | null | 'unmounted'>(null)
  const visible = useMemo(
    () => filterSessionsByAxis(conversations, { agentId: agentAxis, workspaceId: projectAxis, keyword }),
    [conversations, agentAxis, projectAxis, keyword]
  )

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

  const version = useRegistryVersion()
  const pages = useMemo(() => registry.getPages(), [version])
  const features = pages.filter(
    (entry) => (pinned[entry.def.id] ?? entry.def.defaultPinned ?? false) || moreOpen
  )

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
          {features.map((entry) => {
            const page = entry.def
            const isPinned = pinned[page.id] ?? page.defaultPinned ?? false
            return (
              <li className="side__feat-row" key={page.id}>
                <button
                  className={`side__feat${entry.def.id === activePage ? ' side__feat--active' : ''}`}
                  type="button"
                  title={page.title}
                  // toggle：已经在那一页，再点一次回聊天，否则用户会被功能页困住
                  onClick={() => onNavigate(nextActivePage(activePage, page.id))}
                >
                  <Icon name={(page.icon as 'compass' | 'pen-line') ?? 'compass'} className="side__feat-icon" />
                  <span className="side__feat-label">{page.title}</span>
                </button>
                <button
                  className="side__pin"
                  type="button"
                  aria-pressed={isPinned}
                  title={isPinned ? '取消固定' : '固定到侧栏'}
                  aria-label={isPinned ? '取消固定' : '固定到侧栏'}
                  onClick={() => setPinned((prev) => ({ ...prev, [page.id]: !isPinned }))}
                >
                  <Icon name="pin" size={13} />
                </button>
              </li>
            )
          })}
          <Slot name="sidebar.features" props={{ activePage, navigate: onNavigate }} />
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
          Agent Bench
          <span className="side__head-note">{assistants.length}</span>
          <Slot name="sidebar.agents.header" props={{ count: assistants.length }} />
        </div>
        <ul className="side__plain">
          {assistants.length === 0 ? (
            <li className="side__empty">还没有 Agent</li>
          ) : (
            assistants.map((assistant) => {
              const bench = computeAgentBenchStatus(assistant.id, conversations, inflightId)
              const active = agentAxis === assistant.id
              return (
                <li key={assistant.id}>
                  <div className="side__agent-row">
                    <button
                      className={`side__row${active ? ' side__row--active' : ''}`}
                      type="button"
                      title={bench.lastTitle ?? assistant.name}
                      onClick={() => setAgentAxis(active ? null : assistant.id)}
                    >
                      <Icon name="user" className="side__row-icon" />
                      <span>{assistant.name}</span>
                      <span
                        className={`side__status${bench.state === 'working' ? ' side__status--working' : ''}`}
                        title={bench.state === 'working' ? bench.lastTitle ?? '执行中' : '空闲待命'}
                      />
                      <span className="side__status-count">{bench.activeCount}</span>
                    </button>
                    <button
                      className="side__pin"
                      type="button"
                      title="管理 Agent"
                      aria-label="管理 Agent"
                      onClick={onOpenAssistants}
                    >
                      <Icon name="settings" size={13} />
                    </button>
                  </div>
                </li>
              )
            })
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
          <span className="side__head-note">
            {projectAxis === 'unmounted' ? '主聊天' : '未归类'}
          </span>
          <Slot name="sidebar.projects.header" props={{ count: conversations.length }} />
          <button
            className="side__head-act"
            type="button"
            title="管理工作区文件"
            aria-label="管理工作区文件"
            onClick={onOpenWorkspace}
          >
            <Icon name="folder" size={13} />
          </button>
        </div>
        <button
          className={`side__row side__row--axis${projectAxis === 'unmounted' ? ' side__row--active' : ''}`}
          type="button"
          onClick={() => {
            setProjectAxis(projectAxis === 'unmounted' ? null : 'unmounted')
            // 回到对话：主舞台停在功能页时，这一行也会被点到
            onNavigate(CHAT_PAGE)
          }}
        >
          <Icon name="folder" className="side__row-icon" />
          <span>主聊天（未挂载项目）</span>
        </button>
        <ul className="side__list">
          {visible.map((conversation) => (
            <li key={conversation.id}>
              <Overridable
                name="sidebar.sessionItem"
                fallback={SessionItem}
                props={{
                  conversation,
                  active: conversation.id === activeId,
                  onSelect: () => onSelect(conversation.id),
                  onRemove: () => onRemove(conversation.id)
                }}
              />
            </li>
          ))}
          {visible.length === 0 && conversations.length > 0 ? (
            <li className="side__empty">没有匹配的会话</li>
          ) : null}
          {conversations.length === 0 ? <li className="side__empty">还没有会话</li> : null}
        </ul>
      </section>

      <Slot name="sidebar.bottom" props={{}} />

      <div className="side__foot">
        <button className="side__act" type="button" onClick={onOpenSettings} title="设置">
          <Icon name="settings" className="side__act-icon" />
          <span className="side__act-label">设置</span>
        </button>
      </div>
    </aside>
  )
}
