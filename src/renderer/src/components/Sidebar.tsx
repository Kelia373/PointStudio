// 侧栏四段：搜索 / 关键功能 / Agent Bench（驻场工位）/ Project。
// 收起态不再做图标轨，整列由 .shell--collapsed 收掉。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent } from 'react'

import type {
  AssistantDto,
  ConversationDto,
  AgentGroupDto,
  AgentWorkerRunDto
} from '../../../shared/types/ipc.ts'
import {
  AGENT_GROUPS_KEY,
  addAgentToGroup,
  computeGroupBenchStatus,
  createGroup,
  filterAgents,
  normalizeGroups,
  parseAgentGroups,
  removeAgentFromGroup,
  removeGroup,
  renameGroup,
  sortAgents,
  toggleGroupCollapsed,
  type AgentSortMode
} from '../lib/agentGroups'
import {
  AGENT_CLIPBOARD_KEY,
  isAgentNameTaken,
  parseAgentClip,
  serializeAgentClip,
  type AgentClipPayload
} from '../lib/agentClipboard'
import { buildAgentMenuItems, type AgentMenuAction } from '../lib/agentMenu'
import { computeAgentBenchStatus, computeAgentWorkerLanes, LIGHT_LABEL } from '../lib/dispatchFilter'
import type { PlanRunStatus } from '../lib/planRunState'
import { nextActivePage } from '../lib/pageNav'
import { partitionConversations } from '../lib/conversationBuckets'
import { registry } from '../runtime/registry'
import { Overridable, Slot, useRegistryVersion } from '../runtime/SlotRenderer'
import Icon from './Icon'
import SessionItem from './SessionItem'
import AgentAvatar from './AgentAvatar'

const RUN_STATUS_LABEL: Record<AgentWorkerRunDto['status'], string> = {
  working: '执行中',
  waiting: '待确认',
  error: '异常',
  completed: '完成',
  queued: '排队'
}

export default function Sidebar({
  conversations,
  assistants,
  activeId,
  collapsed,
  onToggleCollapse,
  onSelect,
  onCreate,
  onRemove,
  onAgentSettings,
  onRenameAgent,
  onSetAgentEnabled,
  onRemoveAgent,
  onPasteAgent,
  onOpenSettings,
  onOpenWorkspace,
  activePage,
  onNavigate,
  inflightId,
  planStatus,
  planSessionId,
  workerRuns,
  onInspectWorkerRun,
  onCreateAgent,
  assistantsLoaded,
  onOpenGroupChat,
  onOpenAgentHome,
  onCreateAgentTopic,
  onNewAgentHome,
  onRenameConversation,
  onGroupsChanged
}: {
  conversations: ConversationDto[]
  assistants: AssistantDto[]
  activeId: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onSelect: (id: string) => void
  onCreate: () => void
  onRemove: (id: string) => void
  /** 打开某个 Agent 的设置（抽屉）。 */
  onAgentSettings: (id: string) => void
  /** 改名；返回错误码，null 表示成功。 */
  onRenameAgent: (id: string, name: string) => Promise<string | null>
  onSetAgentEnabled: (id: string, enabled: boolean) => Promise<void>
  onRemoveAgent: (id: string) => Promise<void>
  /** 粘贴：创建成功后返回新 Agent，界面据此直接进入重命名。 */
  onPasteAgent: (payload: AgentClipPayload) => Promise<{ id: string; name: string } | null>
  onOpenSettings: () => void
  /** 打开工作区面板：导入文件供检索引用。 */
  onOpenWorkspace: () => void
  /** 当前主舞台页面，用于高亮功能项。 */
  activePage: string
  onNavigate: (pageId: string) => void
  /** 正在流式输出的会话 id（不是 requestId），用于驻场状态。 */
  inflightId: string | null
  /** 当前会话的 Agent 计划状态；只对绑定在该 Agent 上的会话亮灯。 */
  planStatus?: PlanRunStatus | null
  /** 发起这条计划的会话 id；计划灯只亮在它身上。 */
  planSessionId?: string | null
  /** 真实派生出来的并发 Run（流式 / 计划）。 */
  workerRuns?: AgentWorkerRunDto[]
  /** 点子泳道：打开右侧副画布定位到该 Run 的会话。 */
  onInspectWorkerRun?: (run: AgentWorkerRunDto) => void
  /** 新建 Agent：展开对话区的内联创建表单。 */
  onCreateAgent: () => void
  /** 助手列表是否已从主进程加载完；未加载时不能修剪小组。 */
  assistantsLoaded: boolean
  /** 打开（或创建）该小组的聊天。 */
  onOpenGroupChat: (group: AgentGroupDto) => void
  /** 单击 Agent 行：进它的常驻主聊天（没有就建）。 */
  onOpenAgentHome: (agentId: string) => void
  /** 给 Agent 新开专题子会话。 */
  onCreateAgentTopic: (agentId: string) => void
  /** 右键「开启新主聊天」。 */
  onNewAgentHome: (agentId: string) => void
  /** 行内重命名会话；返回错误码，null 表示成功。 */
  onRenameConversation: (id: string, title: string) => Promise<string | null>
  /** 小组成员变更后通知上层刷新 @ 候选。 */
  onGroupsChanged: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  // 固定到侧栏的功能；未固定的收进「更多」。缺省值来自页面自身的 defaultPinned。
  const [pinned, setPinned] = useState<Record<string, boolean>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  // 双轴：点 Agent 行 = 只看它跨项目的记录；点项目 = 看该项目下所有 Agent。
  // 工位区：整段可折叠、行上右键出菜单、改名在行内完成
  const [agentsOpen, setAgentsOpen] = useState(true)
  // 项目区：与 Agent Bench 同样是可折叠的分区头
  const [freeChatsOpen, setProjectsOpen] = useState(true)
  const [menu, setMenu] = useState<{ agentId: string; x: number; y: number } | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renameError, setRenameError] = useState<string | null>(null)
  // Agent Bench 的搜索 / 筛选 / 小组
  const [agentKeyword, setAgentKeyword] = useState('')
  const [agentSearchOpen, setAgentSearchOpen] = useState(false)
  const [filterMenu, setFilterMenu] = useState<{ x: number; y: number } | null>(null)
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const [groupView, setGroupView] = useState<'grouped' | 'flat'>('grouped')
  const [sortMode, setSortMode] = useState<AgentSortMode>('manual')
  const [hideDisabled, setHideDisabled] = useState(false)
  const [groups, setGroups] = useState<AgentGroupDto[]>(() =>
    parseAgentGroups(window.localStorage.getItem(AGENT_GROUPS_KEY))
  )
  const [newGroupOpen, setNewGroupOpen] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [renameGroupValue, setRenameGroupValue] = useState('')
  const [draggingAgentId, setDraggingAgentId] = useState<string | null>(null)
  const [dropGroupId, setDropGroupId] = useState<string | null>(null)
  const [openTopics, setOpenTopics] = useState<Record<string, boolean>>({})
  const [groupMenu, setGroupMenu] = useState<{
    groupId: string
    x: number
    y: number
    submenu: 'members' | 'more' | null
  } | null>(null)
  // 应用内剪贴板：只存配置，不存 id 与时间戳
  const [clipboard, setClipboard] = useState<AgentClipPayload | null>(() =>
    parseAgentClip(window.localStorage.getItem(AGENT_CLIPBOARD_KEY))
  )

  const menuAgent = menu ? (assistants.find((item) => item.id === menu.agentId) ?? null) : null

  function startRename(agent: AssistantDto): void {
    setRenamingId(agent.id)
    setRenameValue(agent.name)
    setRenameError(null)
    setMenu(null)
  }

  function cancelRename(): void {
    setRenamingId(null)
    setRenameError(null)
  }

  async function commitRename(): Promise<void> {
    if (!renamingId) {
      return
    }
    const name = renameValue.trim()
    if (name === '') {
      setRenameError('名字不能为空')
      return
    }
    const others = assistants.filter((item) => item.id !== renamingId).map((item) => item.name)
    if (isAgentNameTaken(name, others)) {
      setRenameError('已存在同名智能体')
      return
    }
    const error = await onRenameAgent(renamingId, name)
    if (error) {
      setRenameError(error)
      return
    }
    setRenamingId(null)
    setRenameError(null)
  }

  function commitNewGroup(): void {
    const name = newGroupName.trim()
    setNewGroupOpen(false)
    setNewGroupName('')
    if (name === '') {
      return
    }
    setGroups((current) =>
      createGroup(current, { id: crypto.randomUUID(), name, now: new Date().toISOString() })
    )
    setGroupView('grouped')
  }

  function commitGroupRename(): void {
    if (!renamingGroupId) {
      return
    }
    const id = renamingGroupId
    const name = renameGroupValue.trim()
    setRenamingGroupId(null)
    if (name !== '') {
      setGroups((current) => renameGroup(current, id, name, new Date().toISOString()))
    }
  }

  function startAgentDrag(agentId: string, event: ReactDragEvent<HTMLSpanElement>): void {
    event.dataTransfer.setData('text/x-agent-id', agentId)
    event.dataTransfer.effectAllowed = 'copy'
    setDraggingAgentId(agentId)
  }

  function endAgentDrag(): void {
    setDraggingAgentId(null)
    setDropGroupId(null)
  }

  function dragOverGroup(groupId: string, event: ReactDragEvent<HTMLDivElement>): void {
    if (!draggingAgentId) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDropGroupId(groupId)
  }

  function dropOnGroup(groupId: string, event: ReactDragEvent<HTMLDivElement>): void {
    event.preventDefault()
    const agentId = event.dataTransfer.getData('text/x-agent-id') || draggingAgentId
    setDropGroupId(null)
    setDraggingAgentId(null)
    if (!agentId) {
      return
    }
    // 多归属：只是「加入」这个组，不把人从别的组或全量池里移走；落组后自动展开
    setGroups((current) =>
      toggleGroupCollapsed(
        addAgentToGroup(current, agentId, groupId, 'multi', new Date().toISOString()),
        groupId,
        false
      )
    )
  }

  async function runMenuAction(action: AgentMenuAction): Promise<void> {
    const agent = menuAgent
    if (!agent) {
      return
    }
    switch (action) {
      case 'rename':
        startRename(agent)
        return
      case 'settings':
        onAgentSettings(agent.id)
        setMenu(null)
        return
      case 'copy': {
        const payload: AgentClipPayload = {
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          providerId: agent.providerId,
          modelId: agent.modelId,
          params: agent.params
        }
        window.localStorage.setItem(AGENT_CLIPBOARD_KEY, serializeAgentClip(payload))
        setClipboard(payload)
        setMenu(null)
        return
      }
      case 'paste': {
        if (!clipboard) {
          return
        }
        const created = await onPasteAgent(clipboard)
        setMenu(null)
        if (created) {
          // 粘贴完直接进入重命名：粘出来的是副本，名字必须由人定
          setRenamingId(created.id)
          setRenameValue(created.name)
          setRenameError(null)
        }
        return
      }
      case 'toggle-enabled':
        await onSetAgentEnabled(agent.id, agent.enabled === false)
        setMenu(null)
        return
      case 'remove':
        if (confirmRemoveId === agent.id) {
          await onRemoveAgent(agent.id)
          setConfirmRemoveId(null)
          setMenu(null)
          return
        }
        // 删除不可撤销：第一下只把这一项变成确认
        setConfirmRemoveId(agent.id)
        return
      default:
        return
    }
  }

  // 小组只存本机；成员列表跟随助手删除自动修剪。
  // 关键：助手列表没加载完时 assistants=[]，此时修剪会把整组人当幽灵清空并写盘。
  useEffect(() => {
    if (!assistantsLoaded) {
      return
    }
    setGroups((current) => normalizeGroups(current, assistants))
  }, [assistants, assistantsLoaded])

  useEffect(() => {
    if (!assistantsLoaded) {
      return
    }
    window.localStorage.setItem(AGENT_GROUPS_KEY, JSON.stringify(groups))
    // 通知上层刷新群聊 @ 候选（不再每帧解析 localStorage）。
    onGroupsChanged()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, assistantsLoaded])

  // 小组右键菜单：点空白或按 Esc 收起
  useEffect(() => {
    if (!groupMenu) {
      return
    }
    const close = (event: MouseEvent): void => {
      const target = event.target as HTMLElement
      if (target.closest('.side__group-menu') === null) {
        setGroupMenu(null)
      }
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setGroupMenu(null)
      }
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [groupMenu])

  const filteredAgents = useMemo(
    () => sortAgents(filterAgents(assistants, { keyword: agentKeyword, hideDisabled }), sortMode),
    [assistants, agentKeyword, hideDisabled, sortMode]
  )
  const filterActive =
    groupView !== 'grouped' || sortMode !== 'manual' || hideDisabled
  const buckets = useMemo(
    () => partitionConversations(conversations, assistants),
    [conversations, assistants]
  )
  // 自由对话只按标题过滤；Agent / 小组会话不再混进这一区。
  const freeChats = useMemo(() => {
    const needle = keyword.trim().toLowerCase()
    if (needle === '') {
      return buckets.freeChats
    }
    return buckets.freeChats.filter((item) => item.title.toLowerCase().includes(needle))
  }, [buckets.freeChats, keyword])

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

  const renderAgentRow = (assistant: AssistantDto, groupId: string | null = null) => {
    const bench = computeAgentBenchStatus(assistant.id, conversations, inflightId, {
      enabled: assistant.enabled !== false,
      planStatus: planStatus ?? null,
      // 计划灯只认发起它的会话；切走会话不会把别的 Agent 点亮
      activeSessionId: planSessionId ?? null,
      ...(workerRuns ? { workerRuns } : {})
    })
    const lanes = computeAgentWorkerLanes(assistant.id, workerRuns ?? [])
    const home = buckets.agentHomeById[assistant.id] ?? null
    const topics = buckets.agentTopicsById[assistant.id] ?? []
    const active =
      home?.id === activeId || topics.some((item) => item.id === activeId)
    const topicsOpen =
      openTopics[assistant.id] ??
      topics.some((item) => item.id === activeId)
    const disabled = assistant.enabled === false

    if (renamingId === assistant.id) {
      return (
        <li key={`${groupId ?? 'roster'}-${assistant.id}`}>
          <input
            className={`side__row-input${renameError ? ' side__row-input--bad' : ''}`}
            value={renameValue}
            autoFocus
            aria-label="重命名智能体"
            onChange={(event) => {
              setRenameValue(event.target.value)
              setRenameError(null)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void commitRename()
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                cancelRename()
              }
            }}
            onBlur={() => void commitRename()}
          />
          {renameError ? <span className="side__row-hint">{renameError}</span> : null}
        </li>
      )
    }

    const row = (
      <button
        className={`side__row${active ? ' side__row--active' : ''}${
          disabled ? ' side__row--disabled' : ''
        }`}
        type="button"
        title={`${bench.lastTitle ?? assistant.name}${
          disabled ? '（已停用）' : ''
        } · 按住头像可拖进小组 · 右键打开菜单`}
        onClick={() => onOpenAgentHome(assistant.id)}
        onContextMenu={(event) => {
          event.preventDefault()
          setConfirmRemoveId(null)
          // 贴边右键时把菜单推回视口内，别让它跑到屏幕外
          setMenu({
            agentId: assistant.id,
            x: Math.min(event.clientX, window.innerWidth - 184),
            y: Math.min(event.clientY, window.innerHeight - 216)
          })
        }}
      >
        <span
          className="side__avatar-handle"
          draggable
          title="按住拖到上方小组里加入"
          onDragStart={(event) => startAgentDrag(assistant.id, event)}
          onDragEnd={endAgentDrag}
        >
          <AgentAvatar agentId={assistant.id} name={assistant.name} avatar={assistant.avatar} size={16} />
        </span>
        <span>{assistant.name}</span>
        <span
          className={`side__status side__status--${bench.state}`}
          title={
            bench.state === 'working' ? bench.lastTitle ?? '执行中' : LIGHT_LABEL[bench.state]
          }
        />
        <span className="side__status-count">{bench.sessionCount}</span>
      </button>
    )

    return (
      <li key={`${groupId ?? 'roster'}-${assistant.id}`}>
        <div className="side__agent-row">
          {row}
          <button
            className="side__row-add"
            type="button"
            title="为该 Agent 新建专题会话"
            aria-label="新建专题会话"
            onClick={(event) => {
              event.stopPropagation()
              onCreateAgentTopic(assistant.id)
            }}
          >
            <Icon name="plus" size={11} />
          </button>
          {groupId !== null ? (
            <button
              className="side__row-remove"
              type="button"
              title="移出小组（不会删除 Agent）"
              aria-label="移出小组"
              onClick={(event) => {
                event.stopPropagation()
                setGroups((current) =>
                  removeAgentFromGroup(current, assistant.id, groupId, new Date().toISOString())
                )
              }}
            >
              <Icon name="x" size={11} />
            </button>
          ) : null}
        </div>
        {groupId === null && topics.length > 0 ? (
          <div className="side__topics">
            <button
              className="side__topics-head"
              type="button"
              aria-expanded={topicsOpen}
              onClick={() =>
                setOpenTopics((current) => ({
                  ...current,
                  [assistant.id]: !topicsOpen
                }))
              }
            >
              <Icon
                name="arrow-down"
                className={`side__head-caret${
                  topicsOpen ? ' is-open' : ''
                }`}
                size={11}
              />
              专题 {topics.length}
            </button>
            {topicsOpen ? (
              <ul className="side__list side__topics-list">
                {topics.map((conversation) => (
                  <li key={conversation.id}>
                    <SessionItem
                      conversation={conversation}
                      active={conversation.id === activeId}
                      onSelect={() => onSelect(conversation.id)}
                      onRemove={() => onRemove(conversation.id)}
                      onRename={(title) => onRenameConversation(conversation.id, title)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {lanes.activeRuns.length > 0 ? (
          <ul className={`side__lanes${disabled ? ' side__lanes--disabled' : ''}`}>
            {lanes.activeRuns.map((run) => (
              <li key={run.runId}>
                <button
                  className="side__lane"
                  type="button"
                  title={`${run.taskTitle} · 点击在右侧副画布查看`}
                  onClick={() => onInspectWorkerRun?.(run)}
                >
                  <span className="side__lane-tag">
                    {run.subagentRole === null ? '主身' : 'Sub'}
                  </span>
                  <span className="side__lane-title">{run.taskTitle}</span>
                  <span className="side__lane-meta">
                    {run.status === 'working' && run.progress
                      ? `${run.progress.current}/${run.progress.total}`
                      : RUN_STATUS_LABEL[run.status]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </li>
    )
  }

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
        <div className="side__head side__head--lg">
          <button
            className="side__head-btn"
            type="button"
            aria-expanded={agentsOpen}
            title={agentsOpen ? '收起全部 Agent' : '展开 Agent 列表'}
            onClick={() => setAgentsOpen((value) => !value)}
          >
            <Icon
              name="arrow-down"
              className={`side__head-caret${agentsOpen ? ' is-open' : ''}`}
              size={13}
            />
            <span className="side__head-title">Agent Bench</span>
            <span className="side__head-note">{assistants.length}</span>
          </button>
          <Slot name="sidebar.agents.header" props={{ count: assistants.length }} />
          <div className="side__head-acts">
            <button
              className={`side__head-act${agentSearchOpen ? ' is-on' : ''}`}
              type="button"
              title="搜索 Agent"
              aria-label="搜索 Agent"
              aria-pressed={agentSearchOpen}
              onClick={() => {
                setAgentSearchOpen((value) => !value)
                if (agentSearchOpen) {
                  setAgentKeyword('')
                }
              }}
            >
              <Icon name="search" size={13} />
            </button>
            <button
              className={`side__head-act${filterActive ? ' is-on' : ''}`}
              type="button"
              title="分组 / 排序 / 筛选"
              aria-label="分组排序筛选"
              onClick={(event) => {
                setAddMenu(null)
                setFilterMenu({
                  x: Math.min(event.clientX, window.innerWidth - 232),
                  y: Math.min(event.clientY, window.innerHeight - 320)
                })
              }}
            >
              <Icon name="filter" size={13} />
            </button>
            <button
              className="side__head-act"
              type="button"
              title="新增智能体或小组"
              aria-label="新增"
              onClick={(event) => {
                setFilterMenu(null)
                setAddMenu({
                  x: Math.min(event.clientX, window.innerWidth - 208),
                  y: Math.min(event.clientY, window.innerHeight - 160)
                })
              }}
            >
              <Icon name="plus" size={13} />
            </button>
          </div>
        </div>

        {agentsOpen ? (
          <>
            {agentSearchOpen ? (
              <div className="side__agent-search">
                <Icon name="search" size={12} className="side__agent-search-icon" />
                <input
                  autoFocus
                  value={agentKeyword}
                  placeholder="搜索 Agent 名称"
                  aria-label="搜索 Agent 名称"
                  onChange={(event) => setAgentKeyword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      setAgentKeyword('')
                      setAgentSearchOpen(false)
                    }
                  }}
                />
                <button
                  className="side__agent-search-close"
                  type="button"
                  aria-label="关闭搜索"
                  onClick={() => {
                    setAgentKeyword('')
                    setAgentSearchOpen(false)
                  }}
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            ) : null}

            {groupView === 'grouped' ? (
              <div className="side__groups">
                {newGroupOpen ? (
                  <div className="side__group-new">
                    <input
                      autoFocus
                      value={newGroupName}
                      placeholder="小组名称，回车创建"
                      aria-label="小组名称"
                      onChange={(event) => setNewGroupName(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          commitNewGroup()
                        }
                        if (event.key === 'Escape') {
                          setNewGroupOpen(false)
                          setNewGroupName('')
                        }
                      }}
                      onBlur={commitNewGroup}
                    />
                  </div>
                ) : null}

                {groups.map((group) => {
                  const members = sortAgents(
                    filterAgents(
                      assistants.filter((agent) => group.memberIds.includes(agent.id)),
                      { keyword: agentKeyword, hideDisabled }
                    ),
                    sortMode
                  )
                  const groupBench = computeGroupBenchStatus(
                    group,
                    assistants,
                    conversations,
                    inflightId,
                    {
                      planStatus: planStatus ?? null,
                      planSessionId: planSessionId ?? null,
                      ...(workerRuns ? { workerRuns } : {})
                    }
                  )
                  if (
                    agentKeyword !== '' &&
                    members.length === 0 &&
                    !group.name.toLowerCase().includes(agentKeyword.toLowerCase())
                  ) {
                    return null
                  }
                  return (
                    <div
                      key={group.id}
                      className={`side__group${
                        dropGroupId === group.id ? ' side__group--drop' : ''
                      }`}
                      onDragOver={(event) => dragOverGroup(group.id, event)}
                      onDragLeave={() =>
                        setDropGroupId((current) => (current === group.id ? null : current))
                      }
                      onDrop={(event) => dropOnGroup(group.id, event)}
                    >
                      <div className="side__group-head">
                        <button
                          className="side__group-caret"
                          type="button"
                          aria-expanded={!group.collapsed}
                          title={group.collapsed ? '展开小组' : '收起小组'}
                          onClick={() =>
                            setGroups((current) => toggleGroupCollapsed(current, group.id))
                          }
                        >
                          <Icon
                            name="arrow-down"
                            className={`side__head-caret${group.collapsed ? '' : ' is-open'}`}
                            size={12}
                          />
                        </button>
                        {renamingGroupId === group.id ? (
                          <input
                            className="side__group-input"
                            autoFocus
                            value={renameGroupValue}
                            aria-label="重命名小组"
                            onChange={(event) => setRenameGroupValue(event.target.value)}
                            onBlur={commitGroupRename}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                commitGroupRename()
                              }
                              if (event.key === 'Escape') {
                                setRenamingGroupId(null)
                              }
                            }}
                          />
                        ) : (
                          <button
                            className="side__group-name"
                            type="button"
                            title="打开小组聊天（右键管理）"
                            onClick={() => onOpenGroupChat(group)}
                            onDoubleClick={() => onOpenGroupChat(group)}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              setGroupMenu({
                                groupId: group.id,
                                x: event.clientX,
                                y: event.clientY,
                                submenu: null
                              })
                            }}
                          >
                            <Icon name="users" size={12} />
                            <span>{group.name}</span>
                            <span className="side__group-count">{members.length}</span>
                          </button>
                        )}
                        <span
                          className={`side__status side__status--${groupBench.state}`}
                          title={LIGHT_LABEL[groupBench.state]}
                        />
                      </div>

                      {group.collapsed ? null : (
                        <>
                          {(buckets.groupChatsById[group.id] ?? []).length > 0 ? (
                            <ul className="side__list side__group-chats">
                              {(buckets.groupChatsById[group.id] ?? []).map((conversation) => (
                                <li key={conversation.id}>
                                  <SessionItem
                                    conversation={conversation}
                                    active={conversation.id === activeId}
                                    onSelect={() => onSelect(conversation.id)}
                                    onRemove={() => onRemove(conversation.id)}
                                    onRename={(title) =>
                                      onRenameConversation(conversation.id, title)
                                    }
                                  />
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        <ul className="side__plain side__group-members">
                          {members.map((agent) => renderAgentRow(agent, group.id))}
                          {members.length === 0 ? (
                            <li className="side__empty">
                              {group.memberIds.length === 0
                                ? '把 Agent 头像拖到这里'
                                : '组内没有匹配的 Agent'}
                            </li>
                          ) : null}
                        </ul>
                        </>
                      )}
                      {dropGroupId === group.id ? (
                        <div className="side__drop">+ 加入「{group.name}」</div>
                      ) : null}
                    </div>
                  )
                })}

                {groups.length === 0 && !newGroupOpen ? (
                  <p className="side__group-hint">点 ＋ 新建小组，或把 Agent 头像拖进来</p>
                ) : null}
              </div>
            ) : null}

            <div className="side__roster-head">
              <span>全部智能体</span>
              <span className="side__head-note">{filteredAgents.length}</span>
            </div>
            <ul className="side__plain">
              {filteredAgents.map((assistant) => renderAgentRow(assistant))}
              {filteredAgents.length === 0 ? (
                <li className="side__empty">
                  {agentKeyword !== '' ? '没有匹配的 Agent' : '还没有 Agent'}
                </li>
              ) : null}
            </ul>
          </>
        ) : null}
      </section>

      {filterMenu ? (
        <>
          <span
            className="ctx-mask"
            role="presentation"
            onClick={() => setFilterMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setFilterMenu(null)
            }}
          />
          <div
            className="side__filter"
            style={{ left: filterMenu.x, top: filterMenu.y }}
            role="menu"
            aria-label="分组排序筛选"
          >
            <span className="side__filter-head">分组</span>
            <button
              className="side__filter-item"
              type="button"
              onClick={() => setGroupView('grouped')}
            >
              <span className="side__check">{groupView === 'grouped' ? '✓' : ''}</span>
              按小组展示
            </button>
            <button
              className="side__filter-item"
              type="button"
              onClick={() => setGroupView('flat')}
            >
              <span className="side__check">{groupView === 'flat' ? '✓' : ''}</span>
              平铺全部智能体
            </button>
            <span className="side__filter-head">排序</span>
            <button
              className="side__filter-item"
              type="button"
              onClick={() => setSortMode('manual')}
            >
              <span className="side__check">{sortMode === 'manual' ? '✓' : ''}</span>
              手动排序
            </button>
            <button
              className="side__filter-item"
              type="button"
              onClick={() => setSortMode('recent')}
            >
              <span className="side__check">{sortMode === 'recent' ? '✓' : ''}</span>
              最近更新
            </button>
            <span className="side__filter-head">筛选</span>
            <button
              className="side__filter-item"
              type="button"
              onClick={() => setHideDisabled((value) => !value)}
            >
              <span className="side__check">{hideDisabled ? '✓' : ''}</span>
              隐藏已停用的 Agent
            </button>
            <span className="side__filter-note">小组协同 · 路由拆解待接入</span>
          </div>
        </>
      ) : null}

      {addMenu ? (
        <>
          <span
            className="ctx-mask"
            role="presentation"
            onClick={() => setAddMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setAddMenu(null)
            }}
          />
          <div
            className="side__filter"
            style={{ left: addMenu.x, top: addMenu.y }}
            role="menu"
            aria-label="新增"
          >
            <button
              className="side__filter-item"
              type="button"
              onClick={() => {
                setAddMenu(null)
                onCreateAgent()
              }}
            >
              新建智能体
            </button>
            <button
              className="side__filter-item"
              type="button"
              onClick={() => {
                setAddMenu(null)
                setNewGroupOpen(true)
                setGroupView('grouped')
              }}
            >
              新建小组
            </button>
          </div>
        </>
      ) : null}

      {menu && menuAgent ? (
        <>
          <span
            className="ctx-mask"
            role="presentation"
            onClick={() => setMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault()
              setMenu(null)
            }}
          />
          <div className="ctx-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            <span className="ctx-menu__head">{menuAgent.name}</span>
            <button
              className="ctx-menu__item"
              type="button"
              role="menuitem"
              onClick={() => {
                onNewAgentHome(menuAgent.id)
                setMenu(null)
              }}
            >
              开启新主聊天
            </button>
            {buildAgentMenuItems({
              enabled: menuAgent.enabled !== false,
              canPaste: clipboard !== null
            }).map((item) => (
              <button
                key={item.action}
                className={`ctx-menu__item${
                  item.action === 'remove' ? ' ctx-menu__item--danger' : ''
                }`}
                type="button"
                role="menuitem"
                disabled={item.disabled === true}
                onClick={() => void runMenuAction(item.action)}
              >
                {item.action === 'remove' && confirmRemoveId === menuAgent.id
                  ? '再点一次确认删除'
                  : item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}

      <section className="side__section side__section--grow">
        <div className="side__head side__head--lg">
          <button
            className="side__head-btn"
            type="button"
            aria-expanded={freeChatsOpen}
            title={freeChatsOpen ? '收起普通聊天' : '展开普通聊天'}
            onClick={() => setProjectsOpen((value) => !value)}
          >
            <Icon name="compass" className="side__head-icon" size={13} />
            <span className="side__head-title">普通聊天</span>
            <span className="side__head-note">{freeChats.length}</span>
            <Icon
              name="arrow-down"
              className={`side__head-caret${freeChatsOpen ? ' is-open' : ''}`}
              size={13}
            />
          </button>
          <Slot name="sidebar.projects.header" props={{ count: freeChats.length }} />
          <button
            className="side__head-act"
            type="button"
            title="工作区（导入文件供检索）"
            aria-label="打开工作区"
            onClick={onOpenWorkspace}
          >
            <Icon name="folder" size={13} />
          </button>
          <button
            className="side__head-act"
            type="button"
            title="新建自由对话"
            aria-label="新建自由对话"
            onClick={onCreate}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        {freeChatsOpen ? (
          <ul className="side__list">
            {freeChats.map((conversation) => (
              <li key={conversation.id}>
                <Overridable
                  name="sidebar.sessionItem"
                  fallback={SessionItem}
                  props={{
                    conversation,
                    active: conversation.id === activeId,
                    onSelect: () => onSelect(conversation.id),
                    onRemove: () => onRemove(conversation.id),
                    onRename: (title: string) => onRenameConversation(conversation.id, title)
                  }}
                />
              </li>
            ))}
            {freeChats.length === 0 && conversations.length > 0 ? (
              <li className="side__empty">没有匹配的自由对话</li>
            ) : null}
            {conversations.length === 0 ? (
              <li className="side__empty">还没有对话</li>
            ) : null}
          </ul>
        ) : null}
      </section>

      {groupMenu
        ? (() => {
            const target = groups.find((group) => group.id === groupMenu.groupId)
            if (!target) {
              return null
            }
            const nowIso = (): string => new Date().toISOString()
            return (
              <div
                className="side__group-menu"
                role="menu"
                aria-label={`小组 ${target.name} 菜单`}
                style={{ left: groupMenu.x, top: groupMenu.y }}
              >
                <button
                  className="side__group-menu-item"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setRenamingGroupId(target.id)
                    setRenameGroupValue(target.name)
                    setGroupMenu(null)
                  }}
                >
                  重命名
                </button>
                <button
                  className={`side__group-menu-item${
                    groupMenu.submenu === 'members' ? ' is-open' : ''
                  }`}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={groupMenu.submenu === 'members'}
                  onMouseEnter={() =>
                    setGroupMenu((current) =>
                      current ? { ...current, submenu: 'members' } : current
                    )
                  }
                  onClick={() =>
                    setGroupMenu((current) =>
                      current
                        ? { ...current, submenu: current.submenu === 'members' ? null : 'members' }
                        : current
                    )
                  }
                >
                  成员管理
                  <span className="side__group-menu-arrow">›</span>
                </button>
                <button
                  className={`side__group-menu-item${
                    groupMenu.submenu === 'more' ? ' is-open' : ''
                  }`}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={groupMenu.submenu === 'more'}
                  onMouseEnter={() =>
                    setGroupMenu((current) =>
                      current ? { ...current, submenu: 'more' } : current
                    )
                  }
                  onClick={() =>
                    setGroupMenu((current) =>
                      current
                        ? { ...current, submenu: current.submenu === 'more' ? null : 'more' }
                        : current
                    )
                  }
                >
                  更多
                  <span className="side__group-menu-arrow">›</span>
                </button>

                {groupMenu.submenu === 'members' ? (
                  <div className="side__group-submenu" role="menu" aria-label="成员管理">
                    <span className="side__group-submenu-title">成员（点击切换）</span>
                    {assistants.length === 0 ? (
                      <span className="side__group-submenu-empty">还没有 Agent</span>
                    ) : (
                      assistants.map((agent) => {
                        const member = target.memberIds.includes(agent.id)
                        return (
                          <button
                            key={agent.id}
                            className={`side__group-menu-item${
                              member ? ' side__group-menu-item--checked' : ''
                            }`}
                            type="button"
                            role="menuitemcheckbox"
                            aria-checked={member}
                            onClick={() =>
                              setGroups((current) =>
                                member
                                  ? removeAgentFromGroup(current, agent.id, target.id, nowIso())
                                  : addAgentToGroup(current, agent.id, target.id, 'multi', nowIso())
                              )
                            }
                          >
                            <span className="side__group-menu-check">{member ? '✓' : ''}</span>
                            {agent.name}
                          </button>
                        )
                      })
                    )}
                  </div>
                ) : null}

                {groupMenu.submenu === 'more' ? (
                  <div className="side__group-submenu" role="menu" aria-label="更多操作">
                    <button
                      className="side__group-menu-item side__group-menu-item--danger"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setGroups((current) => removeGroup(current, target.id))
                        setGroupMenu(null)
                      }}
                    >
                      删除小组
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })()
        : null}

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
