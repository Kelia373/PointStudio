import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  AgentGroupDto,
  ConversationDto,
  ProviderAccountViewDto,
  ReasoningEffortDto
} from '../../../shared/types/ipc.ts'
import { DEFAULT_ASSISTANT_ID } from '../../../shared/types/ipc.ts'
import { describeError } from '../../../shared/i18n/errors.ts'
import { splitMessages, studioStore, useField, useStudioSlice } from '../store/studioStore.ts'
import {
  appendChunk,
  appendReasoning,
  markStatus,
  startTurn,
  storedToUiMessages,
  type UiMessage
} from '../lib/chatState'
import { copyToClipboard } from '../lib/clipboard'
import {
  AUTO_ROUTE_MODEL,
  EFFORT_MAX_TOKENS,
  effortFromMaxTokens,
  modelChoices,
  modelSelectOptions,
  type Effort
} from '../lib/modelOptions'
import {
  autoConfirmedStepIdsForMode,
  stepsRequiringApproval
} from '../lib/planConfirm'
import { reduceAgentEvent } from '../lib/planRunState'
import type { ComponentType } from 'react'

import { registerBuiltinPages } from '../runtime/builtinPages'
import { PluginErrorBoundary } from '../runtime/guard'
import { registry } from '../runtime/registry'
import { Overridable, Slot } from '../runtime/SlotRenderer'
import Annotate from './Annotate'
import AgentCreateDialog from './AgentCreateDialog'
import BrandLogo from './BrandLogo'
import DispatchPill from './DispatchPill'
import MemoryWakeBar from './MemoryWakeBar'
import PlanLens from './PlanLens'
import RouteBadge from './RouteBadge'
import ModelPickerPopover from './ModelPickerPopover'
import ProviderLogo from './ProviderLogo'
import { estimateDifficulty, nextEscalation, planRoute } from '../lib/pandaRouter'
import { loadMemories, matchActiveMemories } from '../lib/memorySpark'
import { appbarLeft, appbarRight } from '../lib/appbarStatus'
import { copyAgentName, uniqueAgentName, type AgentClipPayload } from '../lib/agentClipboard'
import { downloadText, exportFileName } from '../lib/exportFile'
import {
  MODEL_SERVICES_KEY,
  collectModelPositionOptions,
  parseModelServicesState,
  providerDisplayName
} from '../lib/modelServices'
import { CHAT_PAGE, pageAfterSessionPick, pageTitleOf } from '../lib/pageNav'
import {
  EFFORT_SHORT_LABEL,
  resolveConversationComposerPolicy,
  resolvePickerModelCapabilities
} from '../lib/modelPicker'
import { renumber, type PendingImage } from '../lib/imageTokens'
import type { MessageImageDto } from '../../../shared/types/ipc.ts'
import { AGENT_GROUPS_KEY, parseAgentGroups } from '../lib/agentGroups'
import { findAgentHomeConversation } from '../lib/conversationBuckets'
import { computeAgentBenchStatus, type AgentLightState } from '../lib/dispatchFilter'
import { deriveActiveWorkerRuns } from '../lib/workerRuns'
import { buildMissionChains, filterMessagesByMission } from '../lib/missionTrace'
import { buildHandoffEnvelope } from '../lib/handoff'
import {
  SPLIT_DEFAULT_RATIO,
  SPLIT_MARKDOWN_KEY,
  SPLIT_STORAGE_KEY,
  parseSplitState,
  reconcileSplitSession,
  setSecondaryTarget,
  setSplitRatio,
  toggleSplitPane,
  type SplitPaneState
} from '../lib/splitView'
import type { RouteDecisionDto, HandoffEnvelopeDto } from '../../../shared/types/ipc.ts'
import Composer from './Composer'
import EmptyState from './EmptyState'
import Icon from './Icon'
import Inspector, { type InspectorTab } from './Inspector'
import SecondaryPane from './SecondaryPane'
import SettingsPage from './SettingsPage'
import MessageBubble from './MessageBubble'
import PlanPanel from './PlanPanel'
import SettingsPanel from './SettingsPanel'
import Sidebar from './Sidebar'
import WorkspacePanel from './WorkspacePanel'

type Drawer = 'settings' | 'workspace' | 'plan' | null
type Theme = 'dark' | 'light'

const HANDOFF_STORAGE_KEY = 'pointstudio.handoffs'

interface StoredHandoff {
  sessionId: string
  /** 交接发生在哪条消息之后：刷新/落库后插回原位，而不是永远漂在末尾。 */
  afterMessageId?: string | null
  message: UiMessage
}

/** 交接记录只存在本机：主进程还没有任务链表，界面不能假装它落库了。 */
function readHandoffs(): StoredHandoff[] {
  try {
    const raw = window.localStorage.getItem(HANDOFF_STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) {
      return []
    }
    return capHandoffs(
      parsed.filter(
        (item): item is StoredHandoff =>
          typeof item === 'object' &&
          item !== null &&
          typeof (item as StoredHandoff).sessionId === 'string' &&
          typeof (item as StoredHandoff).message?.handoff === 'object' &&
          (item as StoredHandoff).message.handoff !== null
      )
    )
  } catch {
    return []
  }
}

/** 每个会话各留最近 50 条；按整份数组切会把别的会话一起挤掉。 */
function capHandoffs(items: StoredHandoff[]): StoredHandoff[] {
  const kept = new Map<string, number>()
  const out: StoredHandoff[] = []
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    const count = kept.get(item.sessionId) ?? 0
    if (count >= 50) {
      continue
    }
    kept.set(item.sessionId, count + 1)
    out.unshift(item)
  }
  return out
}

function readTheme(): Theme {
  const stored = window.localStorage.getItem('pointstudio.theme')
  return stored === 'light' ? 'light' : 'dark'
}

function readModelServices() {
  return parseModelServicesState(window.localStorage.getItem(MODEL_SERVICES_KEY))
}

function formatMs(value: number): string {
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`
}

/**
 * 工作台外壳：侧栏 + 对话流 + 检查器。
 *
 * 真相在磁盘上，不在组件里：发送结束后统一从主进程重新拉取会话与消息，
 * 组件只保留一个「正在流式」的临时气泡。这样界面永远不会和数据分叉。
 */
export default function ChatPanel() {
  const [conversations, setConversations] = useField('conversations')
  const [activeId, setActiveId] = useField('activeId')
  const [draft, setDraft] = useState('')
  // 待发图片：与 Composer 受控共享，切会话清空。
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  // 本轮快照：onError 兜底回滚时用（后端未落库时把内容还回输入框）。
  const inflightSnapshot = useRef<{ text: string; images: PendingImage[] } | null>(null)
  // onError 的订阅闭包会用到「最新」草稿，用 ref 避开展示层陈旧闭包。
  const draftRef = useRef(draft)
  draftRef.current = draft
  const pendingImagesRef = useRef(pendingImages)
  pendingImagesRef.current = pendingImages
  // 群聊里被 @ 的成员：发送时只有恰好一个时由该成员接管本轮。
  const [mentionedIds, setMentionedIds] = useState<string[]>([])
  // 小组增删改成员后自增，避免 @ 候选每帧去 localStorage 解析一次。
  const [groupsVersion, setGroupsVersion] = useState(0)
  // 最近一轮真实用量与首字延迟（给右侧检查器）。
  const [lastUsage, setLastUsage] = useState<{
    promptTokens: number
    completionTokens: number
    cacheHitTokens: number
    totalTokens: number
  } | null>(null)
  const [firstTokenMs, setFirstTokenMs] = useState<number | null>(null)
  // 双击 / 连点的 in-flight 守卫：create 的 IPC 还没回来时，第二次点击不能再建一条。
  const creatingRef = useRef<Set<string>>(new Set())
  const [busy, setBusy] = useField('busy')
  const [inflightId, setInflightId] = useField('inflightId')
  // 流式时正在输出的是哪条会话（inflightId 是 requestId，不能拿来比会话）
  const [inflightConversationId, setInflightConversationId] = useState<string | null>(null)
  const [mode, setMode] = useField('mode')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  // 上下文裁剪只是提醒，不是错误——用单独的 warn 通道，别染成红色
  const [warn, setWarn] = useState<string | null>(null)
  // 用户往上滚时暂停自动滚底，否则生成过程中根本读不了前文
  const [pinnedToBottom, setPinnedToBottom] = useState(true)
  const [assistants, setAssistants] = useField('assistants')
  // 助手列表是异步拉的：没加载完之前不能拿空数组去修剪小组归属
  const [assistantsLoaded, setAssistantsLoaded] = useState(false)
  const [agentDialogOpen, setAgentDialogOpen] = useState(false)
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [chunkPreview, setChunkPreview] = useState<{
    path: string
    index: number
    text: string
  } | null>(null)
  const [planRun, setPlanRun] = useField('planRun')
  // 标注模式：开关就是顶栏那个按钮，注释掉就能整块移除（见下方 ANNOTATE 注释）
  const [annotate, setAnnotate] = useState(false)

  // 外壳状态
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [inspCollapsed, setInspCollapsed] = useState(false)
  const [inspTab, setInspTab] = useState<InspectorTab>('context')
  // 右栏「智能体」是上下文 tab：只有从 Agent Bench 进来才出现
  const [agentTabOpen, setAgentTabOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 主舞台页面：'chat' 或注册表里的页面 id（插件页 / 内置功能页）
  const [activePage, setActivePage] = useState(CHAT_PAGE)
  // 输入栏选中的是「协同路由」这条策略，而不是某个真实模型名
  const [autoRoute, setAutoRoute] = useState(false)
  // 从右键菜单点「智能体设置」时要定位到的 Agent
  const [agentFocus, setAgentFocus] = useState<string | null>(null)
  // 主群按任务链过滤：null = 全部
  const [missionFilter, setMissionFilter] = useState<string | null>(null)
  // 本机交接记录：主进程还没有任务链表，先按会话存 localStorage
  const [handoffs, setHandoffs] = useState<StoredHandoff[]>(readHandoffs)
  // 左右分屏：状态留在渲染层，只持久化形态与比例；Markdown 草稿单独存一份
  const [split, setSplit] = useState<SplitPaneState>(() => {
    const stored = parseSplitState(window.localStorage.getItem(SPLIT_STORAGE_KEY))
    return { ...stored, markdownText: window.localStorage.getItem(SPLIT_MARKDOWN_KEY) ?? '' }
  })
  const [splitDragging, setSplitDragging] = useState(false)
  const splitRef = useRef<HTMLElement>(null)

  useEffect(() => {
    registerBuiltinPages()
  }, [])

  const activePageEntry = activePage === 'chat' ? null : registry.getPage(activePage)
  const ActivePageComponent = activePageEntry
    ? (activePageEntry.def.component as ComponentType<{ navigate: (pageId: string) => void }>)
    : null
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [provider, setProvider] = useField('provider')
  const [accounts, setAccounts] = useState<ProviderAccountViewDto[]>([])
  const [mcpConnections, setMcpConnections] = useField('mcpConnections')
  const [lastRunMs, setLastRunMs] = useField('lastRunMs')
  // 内容列宽：消息流与输入框共用，拖拽右边界调整，存 local storage。
  const [contentWidth, setContentWidth] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem('pointstudio.contentWidth'))
    return Number.isFinite(stored) && stored >= 480 && stored <= 1400 ? stored : 720
  })
  const historyMessages = useStudioSlice((state) => state.historyMessages)
  const inflightMessage = useStudioSlice((state) => state.inflightMessage)
  const messages = useMemo(
    () => (inflightMessage ? [...historyMessages, inflightMessage] : historyMessages),
    [historyMessages, inflightMessage]
  )
  const setMessages = (next: UiMessage[] | ((prev: UiMessage[]) => UiMessage[])): void => {
    const state = studioStore.getState()
    const current =
      state.inflightMessage === null
        ? state.historyMessages
        : [...state.historyMessages, state.inflightMessage]
    const resolved = typeof next === 'function' ? next(current) : next
    const split = splitMessages(resolved, state.inflightId)
    studioStore.setState({ historyMessages: split.history, inflightMessage: split.inflight })
  }

  const runStartedAt = useRef<number | null>(null)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)

  /**
   * 内容列最宽能拉到多少：不超过消息区实际宽度（减去两侧留白）。
   * 以前硬编码 1400，窗口不够宽时把内容推出视口，逼出一条横向滚动条，
   * 左侧的行号/序号还会被卷出去看不见。
   */
  function clampContentWidth(next: number, separator: HTMLElement): number {
    const stream = separator.closest('.stream') as HTMLElement | null
    const available = (stream?.clientWidth ?? window.innerWidth) - 2 * 24
    const cap = Math.max(320, Math.min(1400, available))
    return Math.round(Math.min(cap, Math.max(360, next)))
  }

  /** 副画布的所有变更都从这里过：保持纯函数语义，内容没变就不造新对象。 */
  const updateSplit = useCallback(
    (
      patch: Partial<
        Pick<SplitPaneState, 'kind' | 'sessionId' | 'pageId' | 'markdownText' | 'traceMissionId'>
      >
    ): void => {
      setSplit((current) => {
        const withText =
          patch.markdownText !== undefined && patch.markdownText !== current.markdownText
            ? { ...current, markdownText: patch.markdownText }
            : current
        return setSecondaryTarget(withText, patch)
      })
    },
    []
  )

  const listRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId

  useEffect(() => {
    window.localStorage.setItem('pointstudio.contentWidth', String(contentWidth))
  }, [contentWidth])

  useEffect(() => {
    document.documentElement.dataset['theme'] = theme
    window.localStorage.setItem('pointstudio.theme', theme)
  }, [theme])

  // 分屏形态与比例落盘；Markdown 草稿单独一个键，拖分隔条时不必反复写大段文本
  useEffect(() => {
    window.localStorage.setItem(SPLIT_MARKDOWN_KEY, split.markdownText)
  }, [split.markdownText])

  useEffect(() => {
    window.localStorage.setItem(
      SPLIT_STORAGE_KEY,
      JSON.stringify({
        enabled: split.enabled,
        kind: split.kind,
        sessionId: split.sessionId,
        pageId: split.pageId,
        traceMissionId: split.traceMissionId,
        ratio: split.ratio
      })
    )
  }, [
    split.enabled,
    split.kind,
    split.sessionId,
    split.pageId,
    split.traceMissionId,
    split.ratio
  ])

  useEffect(() => {
    window.localStorage.setItem(
      HANDOFF_STORAGE_KEY,
      // 落盘也按会话裁剪：全局 slice(-50) 会把别的会话的旧记录一起切掉
      JSON.stringify(capHandoffs(handoffs))
    )
  }, [handoffs])

  // 会话被删或切换后，副画布不能停在一条不存在的会话上
  useEffect(() => {
    setSplit((current) => reconcileSplitSession(current, conversations, activeId))
  }, [conversations, activeId])

  const reloadConversations = useCallback(async (): Promise<ConversationDto[]> => {
    const items = await window.pointstudio.conversations.list()
    setConversations(items)
    return items
  }, [])

  const refreshAssistants = useCallback(async (): Promise<void> => {
    const list = await window.pointstudio.assistants.list()
    setAssistants(list)
    setAssistantsLoaded(true)
  }, [])

  const refreshProvider = useCallback(async (): Promise<void> => {
    const [view, accountList] = await Promise.all([
      window.pointstudio.settings.readProvider(),
      window.pointstudio.providers.listAccounts()
    ])
    setProvider(view)
    setAccounts(accountList)
  }, [])

  const refreshMcp = useCallback(async (): Promise<void> => {
    setMcpConnections(await window.pointstudio.mcp.list())
  }, [])

  const loadMessages = useCallback(async (conversationId: string): Promise<void> => {
    const stored = await window.pointstudio.conversations.messages(conversationId)
    setMessages(storedToUiMessages(stored))
  }, [])

  // 订阅主进程推回来的流式事件。返回的清理函数必须调用，否则会重复追加。
  useEffect(() => {
    const offChunk = window.pointstudio.chat.onChunk(({ id, chunk, kind }) => {
      // 首字延迟按「任何 kind 的第一个 chunk」算：推理模型先吐思考也算已响应。
      if (runStartedAt.current !== null) {
        setFirstTokenMs((current) => current ?? Date.now() - (runStartedAt.current ?? Date.now()))
      }
      if (kind === 'reasoning') {
        setMessages((prev) => appendReasoning(prev, id, chunk))
        return
      }
      setMessages((prev) => appendChunk(prev, id, chunk))
    })

    const offUsage = window.pointstudio.chat.onUsage((usage) => {
      setLastUsage({
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        cacheHitTokens: usage.cacheHitTokens,
        totalTokens: usage.totalTokens
      })
    })

    const offDone = window.pointstudio.chat.onDone(({ id }) => {
      // 真正有产出/结束才丢弃快照；error 分支需要它回滚。
      inflightSnapshot.current = null
      setMessages((prev) => markStatus(prev, id, 'complete'))
      setBusy(false)
      setInflightId(null)
      setInflightConversationId(null)
      if (runStartedAt.current !== null) {
        setLastRunMs(Date.now() - runStartedAt.current)
        runStartedAt.current = null
      }
      // 落库完成，用磁盘上的版本覆盖界面。
      const current = activeIdRef.current
      if (current) {
        void loadMessages(current)
        void reloadConversations()
      }
    })

    const offAgent = window.pointstudio.agent.onEvent((event) => {
      setPlanRun((current) => reduceAgentEvent(current, event))
    })

    const offNotice = window.pointstudio.chat.onNotice(({ droppedCount }) => {
      setWarn(`已省略较早的 ${droppedCount} 条消息（超出上下文窗口）`)
    })

    const offError = window.pointstudio.chat.onError(({ id, code }) => {
      if (code === 'E_VISION_UNSUPPORTED') {
        // 视觉拦截发生在落库前：撤掉本轮乐观气泡，把草稿与图片还回输入框。
        const snapshot = inflightSnapshot.current
        inflightSnapshot.current = null
        setMessages((prev) =>
          prev.filter((message) => message.id !== id && message.id !== `local-${id}`)
        )
        if (snapshot !== null) {
          restoreSnapshot(snapshot.text, snapshot.images)
        }
        setError(describeError(code))
      } else {
        setMessages((prev) => markStatus(prev, id, 'error', `（${describeError(code)}）`))
      }
      setBusy(false)
      setInflightId(null)
      setInflightConversationId(null)
      runStartedAt.current = null
    })

    return () => {
      offChunk()
      offDone()
      offNotice()
      offError()
      offUsage()
      offAgent()
    }
  }, [loadMessages, reloadConversations])

  // 首次进入：优先落在「通用助手 · 主聊天」，没有会话就为它建一条。
  useEffect(() => {
    void (async () => {
      await Promise.all([refreshAssistants(), refreshProvider(), refreshMcp()])
      const items = await reloadConversations()
      if (items.length > 0) {
        // 全员归属后不再有自由对话：冷启动默认进通用助手主聊天，主人开箱即聊。
        const home = items.find(
          (item) => item.assistantId === DEFAULT_ASSISTANT_ID && item.isHome === true
        )
        setActiveId((home ?? items[0]).id)
        return
      }
      const created = await window.pointstudio.conversations.create({
        assistantId: DEFAULT_ASSISTANT_ID,
        isHome: true,
        title: '通用助手 · 主聊天'
      })
      if (created.ok) {
        await reloadConversations()
        setActiveId(created.value.id)
      } else {
        setError(describeError(created.code))
      }
    })()
  }, [refreshAssistants, refreshProvider, refreshMcp, reloadConversations])

  // 切换会话就重新读消息——界面不缓存历史，避免分叉。
  useEffect(() => {
    if (activeId) {
      void loadMessages(activeId)
    } else {
      setMessages([])
    }
  }, [activeId, loadMessages])

  useEffect(() => {
    const list = listRef.current
    if (list && pinnedToBottom) {
      list.scrollTop = list.scrollHeight
    }
  }, [messages, pinnedToBottom])

  // info 只是「做成了」的提示，3 秒自己消失，不用人点
  useEffect(() => {
    if (info === null) {
      return
    }
    const timer = window.setTimeout(() => setInfo(null), 3000)
    return () => window.clearTimeout(timer)
  }, [info])

  // Esc：关抽屉 / 关引用预览 / 收起内联助手表单
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return
      }
      if (drawer !== null) {
        setDrawer(null)
        return
      }
      if (chunkPreview !== null) {
        setChunkPreview(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawer, chunkPreview])

  /**
   * 发送一轮。
   *
   * routeOverride：升档重试时直接给定下一棒决策；
   * 没给就看输入栏是不是选了 🐼 Auto，是就现场算一条本地启发式决策。
   * 决策只挂在气泡与 store 上，不会写进会话的 model 字段。
   */
  async function submit(
    textOverride?: string,
    routeOverride?: RouteDecisionDto | null,
    imagesOverride?: MessageImageDto[]
  ): Promise<void> {
    const text = (textOverride ?? draft).trim()
    const conversationId = activeId
    // 唯一快照。历史重发（给了 textOverride）不读输入框里的待发图，
    // 否则会把用户正在打的图片偷塞进历史请求。
    const snapshot =
      textOverride === undefined
        ? { text: textOverride ?? draft, images: pendingImages }
        : {
            text: textOverride,
            images: (imagesOverride ?? []).map((dto, index) => ({
              index: index + 1,
              dto,
              previewUrl: ''
            }))
          }
    const outgoingImages = snapshot.images.map((image) => image.dto)
    if ((text === '' && outgoingImages.length === 0) || busy || !conversationId) {
      return
    }

    // 前置视觉拦截：明确不吃图的模型，不落库、不乐观渲染、不清输入框。
    if (outgoingImages.length > 0) {
      const caps = resolvePickerModelCapabilities(
        readModelServices(),
        activeProviderId ?? provider?.providerId ?? '',
        activeModelLabel
      )
      if (caps.supportsVision === false) {
        setError(describeError('E_VISION_UNSUPPORTED'))
        return
      }
    }

    const route =
      routeOverride ??
      (autoRoute
        ? planRoute(
            text,
            modelChoices(provider?.providerId ?? null, activeConversation?.model ?? null).filter(
              (item) => item !== ''
            )
          )
        : null)
    if (route) {
      studioStore.setState({ lastRouteDecision: route })
    }

    const requestId = crypto.randomUUID()
    // 记快照：后端拦截（自动路由 / catalog 未命中）时用 onError 回滚。
    inflightSnapshot.current = snapshot
    // 乐观渲染：用户消息（含附图缩略图）与空气泡先上屏，chunk 到达即可追加。
    setMessages((prev) =>
      startTurn(prev, {
        requestId,
        text,
        route,
        ...(outgoingImages.length > 0 ? { images: outgoingImages } : {})
      })
    )
    if (textOverride === undefined) {
      setDraft('')
      setPendingImages([])
    }
    setBusy(true)
    setInflightId(requestId)
    setInflightConversationId(conversationId)
    // 发新消息时退出任务链过滤，否则刚发的这句会被过滤掉
    setMissionFilter(null)
    runStartedAt.current = Date.now()
    setFirstTokenMs(null)
    setLastUsage(null)
    setError(null)

    // 只认当前候选里的成员：成员被移出组后，残留的 id 不再参与路由。
    const validMentionIds = mentionedIds.filter((id) =>
      mentionCandidates.some((candidate) => candidate.id === id)
    )
    const result = await window.pointstudio.chat.send({
      id: requestId,
      conversationId,
      text,
      // 群聊只 @ 了一个成员时，由该成员接管本轮；多 @/未 @ 仍由会话绑定的组长回答。
      ...(validMentionIds.length === 1 ? { assistantId: validMentionIds[0] } : {}),
      // 无图时省略字段（isMessageImages 拒收空数组）。
      ...(outgoingImages.length > 0 ? { images: outgoingImages } : {})
    })
    if (result.ok) {
      setMode(result.mode)
      setMentionedIds([])
      // 不能在这里清快照：主进程先同步返回 ok，再异步推 error（视觉拦截走这条），
      // 提前清会让 onError 的回滚拿不到内容。清空点放在 onDone / 首个 chunk。
      return
    }
    setMessages((prev) => markStatus(prev, requestId, 'error', `（${describeError(result.code)}）`))
    restoreSnapshot(snapshot.text, snapshot.images)
    setBusy(false)
    setInflightId(null)
    setInflightConversationId(null)
    runStartedAt.current = null
  }

  /**
   * 失败回填：不覆盖用户新输入。
   * - 输入框空 → 直接放回；
   * - 已有新内容 → 原文本前插（附图的快照在前，保证旧胶囊仍指旧图），整体重排编号。
   */
  function restoreSnapshot(text: string, images: PendingImage[]): void {
    if (text.trim() === '' && images.length === 0) {
      return
    }
    const latestDraft = draftRef.current
    const latestImages = pendingImagesRef.current
    const hasNewContent = latestDraft.trim() !== '' || latestImages.length > 0
    if (!hasNewContent) {
      setDraft(text)
      setPendingImages(images)
      return
    }
    const mergedImages = [...images, ...latestImages]
    const mergedText = text === '' ? latestDraft : latestDraft === '' ? text : `${text}\n${latestDraft}`
    const merged = renumber(mergedText, mergedImages)
    setDraft(merged.text)
    setPendingImages(merged.images)
    setWarn('上一条未发出，内容已放回输入框顶部')
  }

  async function editAndResend(messageId: string, text: string): Promise<void> {
    // 生成中不裁剪历史：否则删完消息却因 busy 不重发，会留下没有问题的助手回复。
    if (!activeId || busy) {
      return
    }
    const cut = await window.pointstudio.conversations.truncateFrom(activeId, messageId)
    if (!cut.ok) {
      setError(describeError(cut.code))
      return
    }
    await loadMessages(activeId)
    await submit(text)
  }

  async function branchFrom(messageId: string): Promise<void> {
    if (!activeId) {
      return
    }
    const branched = await window.pointstudio.conversations.branch({
      conversationId: activeId,
      upToMessageId: messageId
    })
    if (!branched.ok) {
      setError(describeError(branched.code))
      return
    }
    await reloadConversations()
    setActiveId(branched.value.id)
    setActivePage(CHAT_PAGE)
  }

  async function bindAssistant(assistantId: string): Promise<void> {
    if (!activeId) {
      return
    }
    const bound = await window.pointstudio.conversations.setAssistant(
      activeId,
      assistantId === '' ? null : assistantId
    )
    if (!bound.ok) {
      setError(describeError(bound.code))
      return
    }
    setError(null)
    await reloadConversations()
  }

  async function runPlan(goalOverride?: string, confirmedStepIds?: string[]): Promise<void> {
    const goal = (goalOverride ?? draft).trim()
    if (goal === '' || planRun?.status === 'running') {
      return
    }
    const id = crypto.randomUUID()
    setPlanRun({ id, plan: null, status: 'running', sessionId: activeId })
    setDraft('')
    setInspTab('run')
    setInspCollapsed(false)
    // 不再弹遮罩抽屉：计划在消息流里原地展开，检查器要一直看得见
    const result = await window.pointstudio.agent.run({
      id,
      goal,
      confirmedStepIds,
      permissionMode: boundAssistant?.permissionMode ?? 'smart'
    })
    if (!result.ok) {
      setPlanRun({ id, plan: null, status: 'failed', sessionId: activeId })
    }
  }

  /**
   * 带着「确认结果」重跑。
   * 注意：会重新生成计划（模型可能给出与上次不同的步骤），
   * 真正的"断点续跑"需要把计划快照持久化，属后续工作。
   */
  async function confirmAndResume(): Promise<void> {
    const plan = planRun?.plan
    if (!plan) {
      return
    }
    const mode = boundAssistant?.permissionMode ?? 'smart'
    // 「仅规划」不给执行入口：只允许看计划，不把写操作放过去
    if (mode === 'plan-only') {
      return
    }
    const required = stepsRequiringApproval(plan, mode)
    const ids =
      mode === 'full-access'
        ? autoConfirmedStepIdsForMode(plan, mode)
        : mode === 'ask'
          ? // 逐次确认：一次只放行当前第一个受阻步骤，点一下前进一格
            required.slice(0, 1)
          : required
    await runPlan(plan.goal, ids)
  }

  /** 会话级模型 / 参数：只改当前会话，新会话仍继承全局默认。 */
  async function applyComposerSelection(selection: {
    providerId: string | null
    modelId: string | null
    effort: ReasoningEffortDto | null
  }): Promise<void> {
    if (selection.modelId === AUTO_ROUTE_MODEL) {
      setAutoRoute(true)
      return
    }
    setAutoRoute(false)
    // params 是整组替换：先把会话已有参数带上，再改 effort
    await applyModel({
      model: selection.modelId,
      providerId: selection.providerId,
      params: { ...(activeConversation?.params ?? {}), effort: selection.effort }
    })
  }

  async function applyModel(patch: {
    model?: string | null
    providerId?: string | null
    params?: { maxTokens?: number; effort?: ReasoningEffortDto | null }
  }): Promise<void> {
    if (!activeId) {
      return
    }
    const saved = await window.pointstudio.conversations.setModel(activeId, patch)
    if (!saved.ok) {
      setError(describeError(saved.code))
      return
    }
    setError(null)
    await reloadConversations()
  }

  async function openReference(chunkId: string): Promise<void> {
    const result = await window.pointstudio.workspace.readChunk(chunkId)
    if (!result.ok) {
      setError(describeError(result.code))
      return
    }
    setError(null)
    setChunkPreview(result.value)
  }

  async function copyText(text: string): Promise<void> {
    const ok = await copyToClipboard(text)
    if (!ok) {
      setError('复制失败（剪贴板不可用）')
    }
  }

  async function removeTurn(messageId: string): Promise<void> {
    if (!activeId) {
      return
    }
    const result = await window.pointstudio.conversations.deleteTurn(activeId, messageId)
    if (!result.ok) {
      setError(describeError(result.code))
      return
    }
    setError(null)
    await loadMessages(activeId)
  }

  /**
   * 改一个 Agent 的局部字段：update 是整条替换，所以其余字段要原样带回去，
   * 否则「改个名字」会把提示词与参数一起清空。
   */
  async function updateAgent(
    id: string,
    patch: { name?: string; enabled?: boolean }
  ): Promise<string | null> {
    const current = assistants.find((item) => item.id === id)
    if (!current) {
      return 'E_NOT_FOUND'
    }
    const result = await window.pointstudio.assistants.update(id, {
      name: patch.name ?? current.name,
      systemPrompt: current.systemPrompt,
      providerId: current.providerId,
      modelId: current.modelId,
      params: current.params,
      enabled: patch.enabled ?? current.enabled ?? true,
      permissionMode: current.permissionMode ?? 'smart',
      avatar: current.avatar ?? null
    })
    if (!result.ok) {
      setError(describeError(result.code))
      return result.code
    }
    setError(null)
    await refreshAssistants()
    return null
  }

  async function removeAgent(id: string): Promise<void> {
    const result = await window.pointstudio.assistants.remove(id)
    if (!result.ok) {
      setError(describeError(result.code))
      return
    }
    setError(null)
    await refreshAssistants()
  }

  /** 粘贴：名字先按「xx 副本」去重，建好后由侧栏接着让用户改名。 */
  async function pasteAgent(payload: AgentClipPayload): Promise<{ id: string; name: string } | null> {
    const name = uniqueAgentName(
      copyAgentName(payload.name),
      assistants.map((item) => item.name)
    )
    const created = await window.pointstudio.assistants.create({
      name,
      systemPrompt: payload.systemPrompt,
      providerId: payload.providerId,
      modelId: payload.modelId,
      params: payload.params
    })
    if (!created.ok) {
      setError(describeError(created.code))
      return null
    }
    setError(null)
    await refreshAssistants()
    return { id: created.value.id, name: created.value.name }
  }

  /** 导出当前会话 Markdown：主进程只回文本，落盘交给系统下载目录。 */
  async function exportConversation(): Promise<void> {
    if (!activeId) {
      return
    }
    const result = await window.pointstudio.conversations.exportMarkdown(activeId)
    if (!result.ok) {
      setError(describeError(result.code))
      return
    }
    const title = conversations.find((item) => item.id === activeId)?.title ?? null
    if (!downloadText(exportFileName(title), result.value)) {
      setError('导出失败（下载不可用）')
      return
    }
    setError(null)
    setInfo('已导出当前会话（Markdown）')
  }

  /** ⚡ 升档重试：拿这一轮的用户提问，换更强的一棒重发。 */
  async function escalateFrom(index: number): Promise<void> {
    const next = nextEscalation(messages[index]?.route ?? null)
    if (!next) {
      return
    }
    let prompt = ''
    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      if (messages[cursor].role === 'user') {
        prompt = messages[cursor].content
        break
      }
    }
    if (prompt.trim() === '') {
      return
    }
    // 真的换一棒再发：chat.send 的契约里没有 model 参数，模型只能落在会话上。
    // 不写这一步，「升档重试」就只是个换了徽章的假动作。
    if (next.chosenModel !== '') {
      await applyModel({ model: next.chosenModel })
      setAutoRoute(false)
    }
    await submit(prompt, next)
  }

  /** 打开（或首次创建）小组聊天：一个小组一条会话，首次绑定组长。 */
  async function openGroupChat(group: AgentGroupDto): Promise<void> {
    const existing = conversations.find((item) => item.groupId === group.id)
    if (existing) {
      setActiveId(existing.id)
      setActivePage(CHAT_PAGE)
      return
    }
    const lead = group.leadAgentId ?? group.memberIds[0] ?? null
    // 标题上限 30 字符，给「小组 · 」留位置。
    const title = `小组 · ${Array.from(group.name).slice(0, 24).join('')}`
    const created = await window.pointstudio.conversations.create({
      title,
      assistantId: lead,
      groupId: group.id
    })
    if (!created.ok) {
      setError(describeError(created.code))
      return
    }
    await reloadConversations()
    setActiveId(created.value.id)
    setActivePage(CHAT_PAGE)
  }

  /** 单击 Agent 行：进它的常驻主聊天；没有就建一条 isHome。 */
  async function openAgentHome(agentId: string): Promise<void> {
    const key = `home:${agentId}`
    if (creatingRef.current.has(key)) {
      return
    }
    creatingRef.current.add(key)
    try {
      await openAgentHomeInner(agentId)
    } finally {
      creatingRef.current.delete(key)
    }
  }

  async function openAgentHomeInner(agentId: string): Promise<void> {
    const existing = findAgentHomeConversation(agentId, conversations)
    if (existing) {
      setActiveId(existing.id)
      setActivePage(CHAT_PAGE)
      return
    }
    const agent = assistants.find((item) => item.id === agentId)
    const created = await window.pointstudio.conversations.create({
      assistantId: agentId,
      isHome: true,
      title: `${Array.from(agent?.name ?? 'Agent').slice(0, 20).join('')} · 主聊天`
    })
    if (!created.ok) {
      setError(describeError(created.code))
      return
    }
    await reloadConversations()
    setActiveId(created.value.id)
    setActivePage(CHAT_PAGE)
  }

  /** 给 Agent 新开专题子会话（不抢主聊天）。 */
  async function createAgentTopic(agentId: string): Promise<void> {
    const key = `topic:${agentId}`
    if (creatingRef.current.has(key)) {
      return
    }
    creatingRef.current.add(key)
    try {
      await createAgentTopicInner(agentId)
    } finally {
      creatingRef.current.delete(key)
    }
  }

  async function createAgentTopicInner(agentId: string): Promise<void> {
    const created = await window.pointstudio.conversations.create({ assistantId: agentId })
    if (!created.ok) {
      setError(describeError(created.code))
      return
    }
    await reloadConversations()
    setActiveId(created.value.id)
    setActivePage(CHAT_PAGE)
  }

  /** 右键「开启新主聊天」：旧主聊天自动降级为专题，消息保留。 */
  async function newAgentHome(agentId: string): Promise<void> {
    const key = `newhome:${agentId}`
    if (creatingRef.current.has(key)) {
      return
    }
    creatingRef.current.add(key)
    try {
      await newAgentHomeInner(agentId)
    } finally {
      creatingRef.current.delete(key)
    }
  }

  async function newAgentHomeInner(agentId: string): Promise<void> {
    const agent = assistants.find((item) => item.id === agentId)
    const created = await window.pointstudio.conversations.create({
      assistantId: agentId,
      isHome: true,
      title: `${Array.from(agent?.name ?? 'Agent').slice(0, 20).join('')} · 主聊天`
    })
    if (!created.ok) {
      setError(describeError(created.code))
      return
    }
    await reloadConversations()
    setActiveId(created.value.id)
    setActivePage(CHAT_PAGE)
  }

  async function renameConversation(id: string, title: string): Promise<string | null> {
    const result = await window.pointstudio.conversations.rename(id, title)
    if (!result.ok) {
      return result.code
    }
    await reloadConversations()
    return null
  }

  async function createConversation(): Promise<void> {
    // 全员归属后，「新建会话」= 给当前 Agent（没有就通用助手）开一条专题。
    const target =
      activeConversation?.assistantId ??
      assistants.find((assistant) => assistant.id === DEFAULT_ASSISTANT_ID)?.id ??
      DEFAULT_ASSISTANT_ID
    const created = await window.pointstudio.conversations.create({ assistantId: target })
    if (!created.ok) {
      setError(describeError(created.code))
      return
    }
    await reloadConversations()
    setActiveId(created.value.id)
    // 新建即回聊天：否则新会话建在功能页背后，用户根本看不见
    setActivePage(pageAfterSessionPick())
  }

  async function removeConversation(id: string): Promise<void> {
    const removed = await window.pointstudio.conversations.remove(id)
    if (!removed.ok) {
      setError(describeError(removed.code))
      return
    }
    const items = await reloadConversations()
    if (id === activeId) {
      setActiveId(items[0]?.id ?? null)
    }
  }

  function closeDrawer(): void {
    // 设置可能改了模型与参数，关掉时刷新检查器里的值。
    if (drawer === 'settings') {
      void refreshProvider()
    }
    setAgentFocus(null)
    setDrawer(null)
  }

  /** 点交接胶囊的「右屏盯盘」：直接开分屏并切到这条任务链。 */
  function openHandoff(handoff: HandoffEnvelopeDto): void {
    setSplit((current) =>
      setSecondaryTarget(toggleSplitPane(current, true), {
        kind: 'trace',
        traceMissionId: handoff.missionId
      })
    )
  }

  const activeConversation = conversations.find((item) => item.id === activeId) ?? null
  const boundAssistant =
    assistants.find((item) => item.id === activeConversation?.assistantId) ?? null
  // 只有真正的小组会话（会话级 groupId）才锁模型；Agent 属于某个小组不影响
  // 它的一对一会话 —— agentGroups 只是侧栏分组，不是会话绑定。
  // 每次都从 localStorage 解析：侧栏刚改完成员，已打开的群聊也能立刻刷新候选。
  const activeGroup = useMemo(() => {
    const groupId = activeConversation?.groupId
    if (!groupId) {
      return null
    }
    return (
      parseAgentGroups(window.localStorage.getItem(AGENT_GROUPS_KEY)).find(
        (group) => group.id === groupId
      ) ?? null
    )
  }, [activeConversation?.groupId, groupsVersion])
  const mentionCandidates = useMemo(
    () =>
      (activeGroup?.memberIds ?? [])
        .map((id) => assistants.find((agent) => agent.id === id))
        .filter((agent): agent is NonNullable<typeof agent> => agent !== undefined)
        .filter((agent) => agent.enabled !== false)
        .map((agent) => ({ id: agent.id, name: agent.name })),
    [activeGroup, assistants]
  )
  useEffect(() => {
    setMentionedIds([])
  }, [activeId])
  const composerModelPolicy = resolveConversationComposerPolicy({
    assistantId: activeConversation?.assistantId ?? null,
    groupId: activeConversation?.groupId ?? null,
    // 全员归属：无主的旧会话也按通用助手锁模型，不再有第二套自由切模型的输入栏。
    defaultAssistantId: DEFAULT_ASSISTANT_ID
  })
  const permissionMode = boundAssistant?.permissionMode ?? 'smart'
  const canConfirmPlan = permissionMode !== 'plan-only'

  // full-access：主进程已对它全部放行，正常不会停；这段仅防御旧版主进程或未来门控变化
  const autoResume = useRef<{ goal: string; count: number }>({ goal: '', count: 0 })
  useEffect(() => {
    if (permissionMode !== 'full-access' || planRun?.status !== 'stopped' || !planRun.plan) {
      return
    }
    if (autoResume.current.goal !== planRun.plan.goal) {
      autoResume.current = { goal: planRun.plan.goal, count: 0 }
    }
    if (autoResume.current.count >= 2) {
      setWarn('完全访问已自动放行两次，计划仍未通过；请检查步骤或降低权限模式。')
      return
    }
    autoResume.current.count += 1
    void confirmAndResume()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissionMode, planRun?.id, planRun?.status])

  // 顶栏派遣胶囊与侧栏共用同一套判定：状态灯不能两处各算一遍
  const agentLights = useMemo(() => {
    const lights = new Map<string, AgentLightState>()
    for (const assistant of assistants) {
      lights.set(
        assistant.id,
        computeAgentBenchStatus(assistant.id, conversations, inflightConversationId, {
          enabled: assistant.enabled !== false,
          planStatus: planRun?.status ?? null,
          // 计划灯认发起会话，不认当前选中会话
          activeSessionId: planRun?.sessionId ?? null
        }).state
      )
    }
    return lights
  }, [assistants, conversations, inflightConversationId, planRun?.status, planRun?.sessionId])

  // 真实并发泳道：只从「正在流式」与「计划在跑/停/失败」派生，没有活跃就是空
  const workerRuns = useMemo(
    () => deriveActiveWorkerRuns({ conversations, inflightConversationId, planRun }),
    [conversations, inflightConversationId, planRun]
  )
  // 任务链只由真实消息里的 handoff / missionId 聚合；普通单聊这里是空的
  const mergedMessages = useMemo(() => {
    const extras = handoffs.filter((item) => item.sessionId === activeId)
    if (extras.length === 0) {
      return messages
    }
    // 主进程将来也写 handoff 时，按 handoffId 去重，避免同一条渲染两次
    const onDisk = new Set(
      messages
        .map((message) => message.handoff?.handoffId)
        .filter((id): id is string => typeof id === 'string')
    )
    const merged = [...messages]
    for (const extra of extras) {
      const handoff = extra.message.handoff
      if (handoff && onDisk.has(handoff.handoffId)) {
        continue
      }
      const anchor = extra.afterMessageId ?? null
      const index = anchor === null ? -1 : merged.findIndex((item) => item.id === anchor)
      if (index >= 0) {
        merged.splice(index + 1, 0, extra.message)
      } else {
        merged.push(extra.message)
      }
    }
    return merged
  }, [messages, handoffs, activeId])
  const missionChains = useMemo(
    () => buildMissionChains(mergedMessages, workerRuns).filter((chain) => chain.messageCount > 0),
    [mergedMessages, workerRuns]
  )
  const visibleMessages = useMemo(
    () => filterMessagesByMission(mergedMessages, missionFilter),
    [mergedMessages, missionFilter]
  )
  const agentNameOf = useCallback(
    (agentId: string): string =>
      agentId === 'owner'
        ? '主人'
        : assistants.find((item) => item.id === agentId)?.name ?? agentId,
    [assistants]
  )

  // 私域记忆：钉入后 memoryTick 变化，唤醒条立刻刷新。
  const lastRouteDecision = useStudioSlice((state) => state.lastRouteDecision)
  const [memoryTick, setMemoryTick] = useState(0)
  const [wakeDismissed, setWakeDismissed] = useState(false)
  useEffect(() => {
    setWakeDismissed(false)
  }, [activeId])

  // 切会话就退出任务链过滤：否则新会话里一条消息都不显示
  useEffect(() => {
    setMissionFilter(null)
  }, [activeId])
  // 最近一次路由决策：优先取消息上记录的，其次取 store 里的。
  const lastRoute = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const route = messages[index].route
      if (route) {
        return route
      }
    }
    return lastRouteDecision
  }, [messages, lastRouteDecision])

  const wakeMemories = useMemo(
    () => matchActiveMemories(loadMemories(), boundAssistant?.id ?? null, null, draft),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memoryTick, boundAssistant, draft]
  )
  const referenceCount = messages.reduce((sum, message) => sum + (message.references?.length ?? 0), 0)
  // parse 按原始字符串缓存：这里每帧只做一次 getItem + 字符串比较，不会重复 JSON.parse
  const modelServicesView = readModelServices()
  const primarySlot = modelServicesView.slots.primaryModel
  const slotFallback = primarySlot !== AUTO_ROUTE_MODEL ? primarySlot : ''
  const defaultModelValue = activeConversation?.model ?? (provider?.model || slotFallback)
  // 只有主进程里真正配通（有 Key / 本地协议）的服务商模型才能选。
  const readyProviderIds = accounts
    .filter((account) => account.hasKey || account.protocol === 'ollama')
    .map((account) => account.providerId)
  const externalModelValues = collectModelPositionOptions(
    modelServicesView,
    readyProviderIds
  ).map((option) => option.value)
  const activeProviderId =
    boundAssistant?.providerId ?? activeConversation?.providerId ?? provider?.providerId ?? null
  const activeModelLabel =
    activeConversation?.model ?? boundAssistant?.modelId ?? provider?.model ?? ''
  const modeLabel = busy ? '生成中' : mode === 'live' ? '真模型' : mode === 'local' ? '本地假流式' : '未发送'

  return (
    <div className={`app${inspCollapsed ? ' app--insp-hidden' : ''}`}>
      <div className={`shell${sideCollapsed ? ' shell--collapsed' : ''}`}>
        <div className="shell__top">
          <div className="brand">
            <BrandLogo variant="tile" size={26} className="brand__logo" />
            <span className="brand__name">PointStudio</span>
            <button
              className="brand__toggle"
              type="button"
              onClick={() => setSideCollapsed((value) => !value)}
              title={sideCollapsed ? '展开侧栏' : '收起侧栏'}
              aria-label={sideCollapsed ? '展开侧栏' : '收起侧栏'}
              aria-expanded={!sideCollapsed}
            >
              <Icon name={sideCollapsed ? 'square-arrow-left' : 'square-arrow-right'} />
            </button>
          </div>

          <header className="topbar">
            {activePageEntry ? (
              <button
                className="topbar__back"
                type="button"
                onClick={() => setActivePage(pageAfterSessionPick())}
                title="返回对话"
              >
                <Icon name="chevron-left" />
                返回对话
              </button>
            ) : null}
            <h1 className="topbar__title">
              {pageTitleOf(activePageEntry?.def ?? null, activeConversation?.title ?? null)}
            </h1>
            <span className="topbar__spacer" />

          <DispatchPill
            agentName={boundAssistant?.name ?? null}
            agentState={
              boundAssistant ? (agentLights.get(boundAssistant.id) ?? 'idle') : null
            }
            agentAvatar={boundAssistant?.avatar ?? null}
            projectName={null}
            // 停用的 Agent 不再进派发候选，但仍在侧栏里看得到、可重新启用
            agents={assistants
              .filter((assistant) => assistant.enabled !== false)
              .map((assistant) => ({
                id: assistant.id,
                name: assistant.name,
                state: agentLights.get(assistant.id) ?? 'idle'
              }))}
            activeAgentId={activeConversation?.assistantId ?? null}
            canSwitch={
              activeConversation != null &&
              activeConversation.isHome !== true &&
              activeConversation.groupId == null
            }
            onPickAgent={(agentId) => {
              if (!activeId) {
                return
              }
              void (async () => {
                const previous = boundAssistant
                const missionId = activeId
                await bindAssistant(agentId)
                const picked = assistants.find((assistant) => assistant.id === agentId) ?? null
                setInfo(picked ? `已交接给 ${picked.name} 继续处理` : '已交接')
                if (!picked || picked.id === previous?.id) {
                  return
                }
                // 真的换人接手才写交接记录：会话里留一条可追的 Handoff，而不是 3 秒后消失的横幅
                const handoff = buildHandoffEnvelope({
                  handoffId: crypto.randomUUID(),
                  missionId,
                  previous: previous ? { id: previous.id, name: previous.name } : null,
                  next: { id: picked.id, name: picked.name },
                  messages
                })
                setHandoffs((prev) =>
                  capHandoffs([
                    ...prev,
                    {
                      sessionId: missionId,
                      afterMessageId: messages.length > 0 ? messages[messages.length - 1].id : null,
                      message: {
                        id: `local-handoff-${handoff.handoffId}`,
                        role: 'assistant',
                        content: '',
                        status: 'complete',
                        missionId,
                        handoff
                      }
                    }
                  ])
                )
                setMissionFilter(null)
              })()
            }}
            onOpenProject={() => setDrawer('workspace')}
          />

          <span
            className={`chip${mode === 'live' ? ' chip--live' : ''}${
              busy ? ' chip--busy' : ''
            }`}
            title={mode === 'live' ? 'API Key 已配置，走真实模型' : '没有 Key 时走本地假流式'}
          >
            <i className="chip__dot" />
            {modeLabel}
          </span>

          {activeProviderId !== null ? (
            <span
              className="chip"
              title="当前会话实际使用的服务商与模型（会话覆盖 > 助手绑定 > 全局默认）"
            >
              {providerDisplayName(activeProviderId, modelServicesView)}
              {activeModelLabel === '' ? '' : ` · ${activeModelLabel}`}
            </span>
          ) : null}

          {lastRunMs !== null ? (
            <span className="chip" title="上一轮生成耗时">
              {formatMs(lastRunMs)}
            </span>
          ) : null}

          <button
            className="icon-btn"
            type="button"
            onClick={() => void exportConversation()}
            disabled={activeId === null}
            title="导出当前会话为 Markdown"
            aria-label="导出当前会话"
          >
            <Icon name="download" />
          </button>

          {/* ANNOTATE：标注模式开关。要关掉这个功能，注释掉下面这一个按钮即可 */}
          <button
            className={`icon-btn${annotate ? ' icon-btn--on' : ''}`}
            type="button"
            data-annot-skip=""
            onClick={() => setAnnotate((value) => !value)}
            title={annotate ? '退出标注模式' : '标注模式：点界面元素写意见'}
            aria-label="切换标注模式"
          >
            <Icon name="pen-line" />
          </button>

          <button
            className="icon-btn"
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '切换到浅色' : '切换到深色'}
            aria-label="切换主题"
          >
            <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
          </button>

          <RouteBadge decision={lastRoute} />

          <Slot name="topbar.right" props={{ sessionId: activeId }} />

          <button
            className={`icon-btn${split.enabled ? ' icon-btn--on' : ''}`}
            type="button"
            aria-pressed={split.enabled}
            onClick={() =>
              setSplit((current) => {
                const next = toggleSplitPane(current)
                // 首次打开时给一个有意义的默认会话；空选择由用户显式挑，不自动回填
                if (next.enabled && next.sessionId === null && conversations.length > 0) {
                  const pick =
                    conversations.find((conversation) => conversation.id !== activeId) ??
                    conversations[0]
                  return setSecondaryTarget(next, { sessionId: pick.id })
                }
                return next
              })
            }
            title={split.enabled ? '关闭左右分屏' : '左右分屏：并排看会话 / 功能页 / 草稿'}
            aria-label="切换左右分屏"
          >
            <Icon name="panel-right" />
          </button>

          <button
            className={`icon-btn${inspCollapsed ? '' : ' icon-btn--on'}`}
            type="button"
            onClick={() => setInspCollapsed((value) => !value)}
            title={inspCollapsed ? '展开检查器' : '收起检查器'}
            aria-label="切换检查器"
          >
            <Icon name={inspCollapsed ? 'chevron-left' : 'chevron-right'} />
          </button>
          </header>
        </div>

        <div className="shell__body">
          <Sidebar
            conversations={conversations}
            activeId={activeId}
            collapsed={sideCollapsed}
            onToggleCollapse={() => setSideCollapsed((value) => !value)}
            onSelect={(id) => {
              setActiveId(id)
              // 点会话永远回聊天：主舞台不能停在功能页
              setActivePage(pageAfterSessionPick())
            }}
            onCreate={() => void createConversation()}
            onRemove={(id) => void removeConversation(id)}
            assistants={assistants}
            onAgentSettings={(id) => {
              // 不再弹遮罩抽屉：把右侧检查器切到「智能体」视图，原地编辑
              setAgentFocus(id)
              setAgentTabOpen(true)
              setInspCollapsed(false)
              setInspTab('agent')
            }}
            onRenameAgent={(id, name) => updateAgent(id, { name })}
            onSetAgentEnabled={async (id, enabled) => {
              await updateAgent(id, { enabled })
            }}
            onRemoveAgent={removeAgent}
            onPasteAgent={pasteAgent}
            onOpenSettings={() => setSettingsOpen(true)}
            onOpenWorkspace={() => setDrawer('workspace')}
            activePage={activePage}
            onNavigate={setActivePage}
            inflightId={inflightConversationId}
            planStatus={planRun?.status ?? null}
            planSessionId={planRun?.sessionId ?? null}
            workerRuns={workerRuns}
            onInspectWorkerRun={(run) => {
              // 子泳道 → 右屏定位到对应会话，左屏主群不跳
              setSplit((current) =>
                setSecondaryTarget(toggleSplitPane(current, true), {
                  kind: 'session',
                  sessionId: run.sessionId
                })
              )
            }}
            onCreateAgent={() => setAgentDialogOpen(true)}
            assistantsLoaded={assistantsLoaded}
          onOpenGroupChat={(group) => void openGroupChat(group)}
          onOpenAgentHome={(agentId) => void openAgentHome(agentId)}
          onCreateAgentTopic={(agentId) => void createAgentTopic(agentId)}
          onNewAgentHome={(agentId) => void newAgentHome(agentId)}
          onRenameConversation={renameConversation}
          onGroupsChanged={() => setGroupsVersion((value) => value + 1)}
          />

          <main
            ref={splitRef}
            className={`main${split.enabled ? ' main--split' : ''}`}
            style={{
              ['--content-w' as string]: `${contentWidth}px`,
              ['--split-ratio' as string]: String(split.ratio)
            }}
          >
            <div className="pane pane--main">
        {ActivePageComponent && activePageEntry ? (
          <PluginErrorBoundary pluginId={activePageEntry.pluginId}>
            <ActivePageComponent navigate={setActivePage} />
          </PluginErrorBoundary>
        ) : (
          <>
        <Slot name="chat.banner" props={{ sessionId: activeId }} />

        {missionChains.length > 0 ? (
          <div className="mission-bar" role="group" aria-label="任务链过滤">
            <button
              className={`mission-chip${missionFilter === null ? ' is-on' : ''}`}
              type="button"
              onClick={() => setMissionFilter(null)}
            >
              全部
            </button>
            {missionChains.map((chain) => (
              <button
                key={chain.missionId}
                className={`mission-chip${missionFilter === chain.missionId ? ' is-on' : ''}`}
                type="button"
                title={chain.title}
                aria-pressed={missionFilter === chain.missionId}
                onClick={() =>
                  setMissionFilter(missionFilter === chain.missionId ? null : chain.missionId)
                }
              >
                <span className="mission-chip__title">{chain.title}</span>
                <span className="mission-chip__meta">
                  {chain.status === 'working'
                    ? `${chain.activeRunCount} 个在跑`
                    : chain.status === 'waiting'
                      ? '等待确认'
                      : chain.status === 'error'
                        ? '异常'
                        : chain.status === 'queued'
                          ? '排队中'
                          : '已完成'}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {info ? (
          <div className="banner banner--info">
            <span className="banner__text">{info}</span>
            <button className="banner__close" type="button" aria-label="关闭提示" onClick={() => setInfo(null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ) : null}
        {warn ? (
          <div className="banner banner--warn">
            <span className="banner__text">{warn}</span>
            <button className="banner__close" type="button" aria-label="关闭提示" onClick={() => setWarn(null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ) : null}
        {error ? (
          <div className="banner banner--error">
            <span className="banner__text">{error}</span>
            <button className="banner__close" type="button" aria-label="关闭提示" onClick={() => setError(null)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ) : null}

        {mergedMessages.length === 0 ? (
          <div className="stream stream--empty">
            <div className="stream__inner stream__inner--empty">
              <div
                className="stream__resize"
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整内容宽度"
                title="拖动调整宽度（双击复位）"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  resizeStart.current = { x: event.clientX, width: contentWidth }
                }}
                onPointerMove={(event) => {
                  const start = resizeStart.current
                  if (!start) {
                    return
                  }
                  const next = start.width + (event.clientX - start.x) * 2
                  setContentWidth(clampContentWidth(next, event.currentTarget))
                }}
                onPointerUp={(event) => {
                  resizeStart.current = null
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onDoubleClick={() => setContentWidth(720)}
              />
              <Overridable
                name="chat.empty"
                fallback={EmptyState}
                props={{ mode, onPick: (text: string) => setDraft(text) }}
              />
            </div>
          </div>
        ) : (
          <>
          <div
            className="stream"
            ref={listRef}
            onScroll={(event) => {
              const el = event.currentTarget
              const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48
              setPinnedToBottom(nearBottom)
            }}
          >
            <div className="stream__inner">
              <div
                className="stream__resize"
                role="separator"
                aria-orientation="vertical"
                aria-label="拖动调整内容宽度"
                title="拖动调整宽度（双击复位）"
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  resizeStart.current = { x: event.clientX, width: contentWidth }
                }}
                onPointerMove={(event) => {
                  const start = resizeStart.current
                  if (!start) {
                    return
                  }
                  // 内容列是居中的：往右拖等于两侧同时变宽，所以按 2 倍位移换算。
                  const next = start.width + (event.clientX - start.x) * 2
                  setContentWidth(clampContentWidth(next, event.currentTarget))
                }}
                onPointerUp={(event) => {
                  resizeStart.current = null
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onDoubleClick={() => setContentWidth(720)}
              />
              {visibleMessages.length === 0 ? (
                <div className="mission-empty">
                  <span>这条任务链在当前会话里没有消息。</span>
                  <button className="mission-chip" type="button" onClick={() => setMissionFilter(null)}>
                    看全部
                  </button>
                </div>
              ) : null}
              {visibleMessages.map((message, index) => (
                <Overridable
                  key={message.id}
                  name="chat.bubble"
                  fallback={MessageBubble}
                  props={{
                    index,
                    role: message.role,
                    content: message.content,
                    streaming: message.status === 'streaming',
                    streamingReasoning:
                      message.status === 'streaming' && message.content === '',
                    reasoning: message.reasoning,
                    reasoningMs: message.reasoningMs,
                    failed: message.status === 'error',
                    references: message.references,
                    onReference: (chunkId: string) => void openReference(chunkId),
                    onCopy: () => void copyText(message.content),
                    onDelete: () => void removeTurn(message.id),
                    ...(message.role === 'user'
                      ? {
                          onResend: () =>
                            void submit(message.content, null, message.images ?? []),
                          onEdit: (next: string) => void editAndResend(message.id, next)
                        }
                      : {}),
                    onBranch: () => void branchFrom(message.id),
                    actionsDisabled: busy,
                    route: message.route ?? null,
                    ...(nextEscalation(message.route ?? null)
                      ? { onEscalate: () => void escalateFrom(index) }
                      : {}),
                    handoff: message.handoff ?? null,
                    ...(message.handoff
                      ? {
                          handoffFrom: agentNameOf(message.handoff.fromAgentId),
                          handoffTo: agentNameOf(message.handoff.toAgentId),
                          onOpenInSplit: () => openHandoff(message.handoff!)
                        }
                      : {}),
                    memory: {
                      agentId: boundAssistant?.id ?? null,
                      workspaceId: null,
                      sessionId: activeId,
                      agentName: boundAssistant?.name ?? 'PointStudio',
                      onChanged: () => setMemoryTick((value) => value + 1)
                    },
                    // 助手身份栏：头像 + Agent 名 + 厂商图标/模型名（仿 Cherry Studio）
                    assistantMeta:                      message.role === 'assistant'
                        ? {
                            agentId: boundAssistant?.id ?? DEFAULT_ASSISTANT_ID,
                            name: boundAssistant?.name ?? '通用助手',
                            avatar: boundAssistant?.avatar ?? null,
                            providerId: activeProviderId,
                            modelLabel: activeModelLabel === '' ? null : activeModelLabel
                          }
                        : null,
                    images: message.images ?? []
                  }}
                />
              ))}
            </div>
            {!pinnedToBottom ? (
              <button
                className="jump-latest"
                type="button"
                aria-label="回到底部"
                title="回到底部"
                onClick={() => {
                  const el = listRef.current
                  if (el) {
                    el.scrollTop = el.scrollHeight
                  }
                  setPinnedToBottom(true)
                }}
              >
                <Icon name="arrow-down" size={14} />
              </button>
            ) : null}
          </div>
          </>
        )}

        <PlanLens
          run={planRun}
          elapsedMs={lastRunMs}
          canConfirm={canConfirmPlan}
          modeHint={
            permissionMode === 'plan-only'
              ? '仅规划模式不会执行工具步骤；切换到其它权限模式后可继续。'
              : null
          }
          onConfirm={() => void confirmAndResume()}
        />

        {wakeDismissed ? null : (
          <MemoryWakeBar
            agentName={boundAssistant?.name ?? null}
            memories={wakeMemories}
            onManage={() => {
              setAgentFocus(boundAssistant?.id ?? null)
              setAgentTabOpen(true)
              setInspCollapsed(false)
              setInspTab('agent')
            }}
            onDismiss={() => setWakeDismissed(true)}
          />
        )}

        <Overridable
          name="chat.composer"
          fallback={Composer}
          props={{
          draft,
          busy,
          canSend: !busy && (draft.trim() !== '' || pendingImages.length > 0) && activeId !== null,
          model: autoRoute ? AUTO_ROUTE_MODEL : defaultModelValue,
          models: modelSelectOptions(
            provider?.providerId ?? null,
            defaultModelValue,
            externalModelValues
          ),
          effort: effortFromMaxTokens(
            activeConversation?.params?.maxTokens ?? provider?.params?.maxTokens
          ),
          onDraftChange: setDraft,
          images: pendingImages,
          onImagesChange: setPendingImages,
          onModelChange: (next: string) => {
            if (next === AUTO_ROUTE_MODEL) {
              // 协同路由是策略不是模型：不落库，只影响这一轮怎么走
              setAutoRoute(true)
              return
            }
            setAutoRoute(false)
            void applyModel({ model: next === '' ? null : next })
          },
          onEffortChange: (level: Effort) =>
            void applyModel({ params: { maxTokens: EFFORT_MAX_TOKENS[level] } }),
          modelPolicy: composerModelPolicy,
          modelPicker: (
            <ModelPickerPopover
              services={modelServicesView}
              accounts={accounts}
              providerId={
                autoRoute
                  ? null
                  : (activeConversation?.providerId ??
                    boundAssistant?.providerId ??
                    provider?.providerId ??
                    null)
              }
              modelId={autoRoute ? AUTO_ROUTE_MODEL : defaultModelValue || null}
              effort={
                activeConversation?.params?.effort ??
                boundAssistant?.params?.effort ??
                null
              }
              topOption={{ value: AUTO_ROUTE_MODEL, label: '🐼 Auto · 协同路由' }}
              compact
              onChange={(selection) => void applyComposerSelection(selection)}
              onOpenSettings={() => setSettingsOpen(true)}
            />
          ),
          mentionCandidates: composerModelPolicy.mode === 'locked-group' ? mentionCandidates : [],
          mentionedIds,
          onMentionedChange: setMentionedIds,
          modelBadge:
            composerModelPolicy.mode === 'locked-group' ? (
              <span>群聊 · @ 成员接管</span>
            ) : (
              <button
                className="composer__model-badge-btn"
                type="button"
                title="模型由该 Agent 的绑定决定，点此去检查器修改"
                onClick={() => {
                  setAgentFocus(boundAssistant?.id ?? null)
                  setAgentTabOpen(true)
                  setInspCollapsed(false)
                  setInspTab('agent')
                }}
              >
                {activeProviderId ? (
                  <ProviderLogo providerId={activeProviderId} size={14} />
                ) : null}
                <span>
                  {activeProviderId
                    ? providerDisplayName(activeProviderId, modelServicesView)
                    : '默认服务商'}
                  {activeModelLabel === '' ? '' : ` · ${activeModelLabel}`}
                  {activeConversation?.params?.effort
                    ? ` · ${EFFORT_SHORT_LABEL[activeConversation.params.effort]}`
                    : ''}
                </span>
              </button>
            ),
          onSend: () => void submit(),
          onStop: () => {
            if (inflightId) {
              void window.pointstudio.chat.cancel(inflightId)
            }
          },
          onPlan: (goal?: string) => void runPlan(goal),
          routePreview: draft.trim() === '' ? null : `预计 L${estimateDifficulty(draft).level} · ${estimateDifficulty(draft).category}`
          }}
        />
          </>
        )}
            </div>

            {split.enabled ? (
              <>
                <div
                  className="split-divider"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="拖动调整分屏比例"
                  aria-valuemin={25}
                  aria-valuemax={75}
                  aria-valuenow={Math.round(split.ratio * 100)}
                  tabIndex={0}
                  title="拖动调整比例（双击复位到一半，方向键微调）"
                  onPointerDown={(event) => {
                    event.currentTarget.setPointerCapture(event.pointerId)
                    setSplitDragging(true)
                  }}
                  onPointerMove={(event) => {
                    if (!splitDragging) {
                      return
                    }
                    const rect = splitRef.current?.getBoundingClientRect()
                    if (!rect || rect.width === 0) {
                      return
                    }
                    setSplit((current) =>
                      setSplitRatio(current, (event.clientX - rect.left) / rect.width)
                    )
                  }}
                  onPointerUp={(event) => {
                    setSplitDragging(false)
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }}
                  onPointerCancel={() => setSplitDragging(false)}
                  onLostPointerCapture={() => setSplitDragging(false)}
                  onKeyDown={(event) => {
                    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
                      return
                    }
                    event.preventDefault()
                    const step = event.key === 'ArrowLeft' ? -0.02 : 0.02
                    setSplit((current) => setSplitRatio(current, current.ratio + step))
                  }}
                  onDoubleClick={() =>
                    setSplit((current) => setSplitRatio(current, SPLIT_DEFAULT_RATIO))
                  }
                />
                <SecondaryPane
                  state={split}
                  conversations={conversations}
                  messages={mergedMessages}
                  workerRuns={workerRuns}
                  agentNameOf={agentNameOf}
                  primarySessionId={activeId}
                  onChange={updateSplit}
                  onClose={() => setSplit((current) => toggleSplitPane(current, false))}
                  onInsertToComposer={(text) =>
                    setDraft((current) =>
                      current.trim() === '' ? text : `${current}\n\n${text}`
                    )
                  }
                  onNavigate={setActivePage}
                />
              </>
            ) : null}
      </main>
        </div>
      </div>

      <Overridable
        name="chat.inspector"
        fallback={Inspector}
        props={{
        tab: inspTab,
        onTab: (next: InspectorTab) => {
          setInspTab(next)
          // 离开智能体页就丢掉定位，并收起这个上下文 tab
          if (next !== 'agent') {
            setAgentTabOpen(false)
            setAgentFocus(null)
          }
        },
        agentTabOpen,
        collapsed: inspCollapsed,
        conversationTitle: activeConversation?.title ?? null,
        assistantName: boundAssistant?.name ?? null,
        mode,
        messageCount: mergedMessages.length,
        referenceCount,
        provider,
        effectiveModel: activeConversation?.model ?? provider?.model ?? '',
        effectiveMaxTokens: activeConversation?.params?.maxTokens ?? provider?.params?.maxTokens,
        modelFromSession: (activeConversation?.model ?? '') !== '',
        lastRunMs,
        firstTokenMs,
        lastUsage,
        onOpenPlan: () => setDrawer('plan'),
        onConfirmPlan: () => void confirmAndResume(),
        canConfirmPlan,
        planRun,
        mcpConnections,
        focusAgentId: agentFocus,
        onAssistantsChanged: () => void refreshAssistants()
        }}
      />
      <Slot name="shell.overlay" props={{}} />

      {/* 底栏：内置状态项由宿主渲染，插槽留给插件追加——没装插件时这里也不空 */}
      <footer className="appbar">
        <span className="appbar__item">
          {appbarLeft({ mode: mode ?? '', busy, model: activeConversation?.model ?? provider?.model ?? '' })}
        </span>
        <Slot name="appbar.left" props={{ mode, busy }} />
        <span className="appbar__spacer" />
        <Slot name="appbar.right" props={{}} />
        <span className="appbar__item appbar__item--right">
          <BrandLogo variant="mark" size={12} className="appbar__brand" />
          {appbarRight({
            sessionCount: conversations.length,
            version: `Electron ${window.pointstudio.electronVersion}`
          })}
        </span>
      </footer>

      {settingsOpen ? <SettingsPage onClose={() => setSettingsOpen(false)} /> : null}

      {agentDialogOpen ? (
        <AgentCreateDialog
          accounts={accounts}
          existingNames={assistants.map((item) => item.name)}
          onClose={() => setAgentDialogOpen(false)}
          onCreated={(assistant) => {
            setAgentDialogOpen(false)
            void refreshAssistants()
            if (activeId) {
              void bindAssistant(assistant.id)
            }
            setInfo(`已创建 ${assistant.name}`)
          }}
        />
      ) : null}

      {chunkPreview ? (
        <div className="chunk-preview">
          <div className="chunk-preview__head">
            <span className="chunk-preview__path">
              {chunkPreview.path} · 第 {chunkPreview.index + 1} 段
            </span>
            <button
              className="chunk-preview__close"
              type="button"
              onClick={() => setChunkPreview(null)}
            >
              关闭
            </button>
          </div>
          <pre className="chunk-preview__text">{chunkPreview.text}</pre>
        </div>
      ) : null}

      {/* ANNOTATE：标注层与开关同生共死，注释掉上面按钮时这里也可一并注释 */}
      <Annotate enabled={annotate} onClose={() => setAnnotate(false)} />

      {drawer ? (
        <>
          <div className="drawer-mask" onClick={closeDrawer} />
          <div className="drawer" role="dialog" aria-modal="true">
            {drawer === 'settings' ? <SettingsPanel onClose={closeDrawer} /> : null}
            {drawer === 'workspace' ? <WorkspacePanel onClose={closeDrawer} /> : null}
            {drawer === 'plan' ? (
              planRun?.plan ? (
                <PlanPanel
                  plan={planRun.plan}
                  status={planRun.status}
                  details={planRun.details}
                  onClose={() => setDrawer(null)}
                  onConfirm={
                    planRun.status === 'stopped' && canConfirmPlan
                      ? () => void confirmAndResume()
                      : undefined
                  }
                />
              ) : (
                <div className="plan">
                  <div className="plan__head">
                    <span className="plan__goal">正在生成计划…</span>
                    <button className="plan__close" type="button" onClick={() => setDrawer(null)}>
                      关闭
                    </button>
                  </div>
                  <p className="plan__note">
                    模型正在拆解目标。进度与每一步的结果会同步到右侧检查器的「运行」。
                  </p>
                </div>
              )
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
