import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AssistantDto,
  ChatMode,
  ConversationDto,
  McpConnectionDto,
  ProviderSettingsViewDto
} from '../../../shared/types/ipc.ts'
import { describeError } from '../../../shared/i18n/errors.ts'
import { appendChunk, markStatus, startTurn, type UiMessage } from '../lib/chatState'
import { copyToClipboard } from '../lib/clipboard'
import {
  EFFORT_MAX_TOKENS,
  effortFromMaxTokens,
  modelChoices,
  type Effort
} from '../lib/modelOptions'
import { pendingHighRiskStepIds } from '../lib/planConfirm'
import { reduceAgentEvent, type PlanRunState } from '../lib/planRunState'
import Annotate from './Annotate'
import AssistantPanel from './AssistantPanel'
import Composer from './Composer'
import EmptyState from './EmptyState'
import Icon from './Icon'
import Inspector, { type InspectorTab } from './Inspector'
import MessageBubble from './MessageBubble'
import PlanPanel from './PlanPanel'
import SettingsPanel from './SettingsPanel'
import Sidebar from './Sidebar'
import WorkspacePanel from './WorkspacePanel'

type Drawer = 'settings' | 'assistants' | 'workspace' | 'plan' | null
type Theme = 'dark' | 'light'

function readTheme(): Theme {
  const stored = window.localStorage.getItem('pointstudio.theme')
  return stored === 'light' ? 'light' : 'dark'
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
  const [conversations, setConversations] = useState<ConversationDto[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [inflightId, setInflightId] = useState<string | null>(null)
  const [mode, setMode] = useState<ChatMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [assistants, setAssistants] = useState<AssistantDto[]>([])
  const [drafting, setDrafting] = useState(false)
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [chunkPreview, setChunkPreview] = useState<{
    path: string
    index: number
    text: string
  } | null>(null)
  const [planRun, setPlanRun] = useState<PlanRunState | null>(null)
  const [assistantName, setAssistantName] = useState('')
  const [assistantPrompt, setAssistantPrompt] = useState('')
  // 标注模式：开关就是顶栏那个按钮，注释掉就能整块移除（见下方 ANNOTATE 注释）
  const [annotate, setAnnotate] = useState(false)

  // 外壳状态
  const [sideCollapsed, setSideCollapsed] = useState(false)
  const [inspCollapsed, setInspCollapsed] = useState(false)
  const [inspTab, setInspTab] = useState<InspectorTab>('context')
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [provider, setProvider] = useState<ProviderSettingsViewDto | null>(null)
  const [mcpConnections, setMcpConnections] = useState<McpConnectionDto[]>([])
  const [lastRunMs, setLastRunMs] = useState<number | null>(null)
  // 内容列宽：消息流与输入框共用，拖拽右边界调整，存 local storage。
  const [contentWidth, setContentWidth] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem('pointstudio.contentWidth'))
    return Number.isFinite(stored) && stored >= 480 && stored <= 1400 ? stored : 720
  })
  const runStartedAt = useRef<number | null>(null)
  const resizeStart = useRef<{ x: number; width: number } | null>(null)

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

  const reloadConversations = useCallback(async (): Promise<ConversationDto[]> => {
    const items = await window.pointstudio.conversations.list()
    setConversations(items)
    return items
  }, [])

  const refreshAssistants = useCallback(async (): Promise<void> => {
    setAssistants(await window.pointstudio.assistants.list())
  }, [])

  const refreshProvider = useCallback(async (): Promise<void> => {
    setProvider(await window.pointstudio.settings.readProvider())
  }, [])

  const refreshMcp = useCallback(async (): Promise<void> => {
    setMcpConnections(await window.pointstudio.mcp.list())
  }, [])

  const loadMessages = useCallback(async (conversationId: string): Promise<void> => {
    const stored = await window.pointstudio.conversations.messages(conversationId)
    setMessages(
      stored.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status,
        references: message.references
      }))
    )
  }, [])

  // 订阅主进程推回来的流式事件。返回的清理函数必须调用，否则会重复追加。
  useEffect(() => {
    const offChunk = window.pointstudio.chat.onChunk(({ id, chunk }) => {
      setMessages((prev) => appendChunk(prev, id, chunk))
    })

    const offDone = window.pointstudio.chat.onDone(({ id }) => {
      setMessages((prev) => markStatus(prev, id, 'complete'))
      setBusy(false)
      setInflightId(null)
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
      setError(`已省略较早的 ${droppedCount} 条消息（超出上下文窗口）`)
    })

    const offError = window.pointstudio.chat.onError(({ id, code }) => {
      setMessages((prev) => markStatus(prev, id, 'error', `（${describeError(code)}）`))
      setBusy(false)
      setInflightId(null)
      runStartedAt.current = null
    })

    return () => {
      offChunk()
      offDone()
      offNotice()
      offError()
      offAgent()
    }
  }, [loadMessages, reloadConversations])

  // 首次进入：有会话就用最近一个，没有就建一个。
  useEffect(() => {
    void (async () => {
      await Promise.all([refreshAssistants(), refreshProvider(), refreshMcp()])
      const items = await reloadConversations()
      if (items.length > 0) {
        setActiveId(items[0].id)
        return
      }
      const created = await window.pointstudio.conversations.create({})
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
    if (list) {
      list.scrollTop = list.scrollHeight
    }
  }, [messages])

  async function submit(textOverride?: string): Promise<void> {
    const text = (textOverride ?? draft).trim()
    const conversationId = activeId
    if (text === '' || busy || !conversationId) {
      return
    }

    const requestId = crypto.randomUUID()
    // 乐观渲染：用户消息与空气泡先上屏，chunk 到达即可追加。
    setMessages((prev) => startTurn(prev, { requestId, text }))
    if (textOverride === undefined) {
      setDraft('')
    }
    setBusy(true)
    setInflightId(requestId)
    runStartedAt.current = Date.now()
    setError(null)

    const result = await window.pointstudio.chat.send({ id: requestId, conversationId, text })
    if (result.ok) {
      setMode(result.mode)
      return
    }
    setMessages((prev) => markStatus(prev, requestId, 'error', `（${describeError(result.code)}）`))
    setBusy(false)
    setInflightId(null)
    runStartedAt.current = null
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
    setPlanRun({ id, plan: null, status: 'running' })
    setDraft('')
    setInspTab('run')
    setInspCollapsed(false)
    setDrawer('plan')
    const result = await window.pointstudio.agent.run({ id, goal, confirmedStepIds })
    if (!result.ok) {
      setPlanRun({ id, plan: null, status: 'failed' })
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
    await runPlan(plan.goal, pendingHighRiskStepIds(plan))
  }

  /** 会话级模型 / 参数：只改当前会话，新会话仍继承全局默认。 */
  async function applyModel(patch: {
    model?: string | null
    params?: { maxTokens?: number }
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

  async function exportConversation(): Promise<void> {
    const conversationId = activeId
    if (!conversationId) {
      return
    }
    const result = await window.pointstudio.conversations.exportMarkdown(conversationId)
    if (!result.ok) {
      setError(describeError(result.code))
      return
    }
    await copyText(result.value)
    setError(null)
    setInfo('已复制 Markdown 到剪贴板')
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

  async function createAssistant(): Promise<void> {
    const name = assistantName.trim()
    if (name === '') {
      return
    }
    const created = await window.pointstudio.assistants.create({
      name,
      systemPrompt: assistantPrompt.trim()
    })
    if (!created.ok) {
      setError(describeError(created.code))
      return
    }
    setAssistantName('')
    setAssistantPrompt('')
    setDrafting(false)
    setError(null)
    await refreshAssistants()
    if (activeId) {
      await bindAssistant(created.value.id)
    }
  }

  async function createConversation(): Promise<void> {
    const created = await window.pointstudio.conversations.create({})
    if (!created.ok) {
      setError(describeError(created.code))
      return
    }
    await reloadConversations()
    setActiveId(created.value.id)
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
    setDrawer(null)
  }

  const activeConversation = conversations.find((item) => item.id === activeId) ?? null
  const boundAssistant =
    assistants.find((item) => item.id === activeConversation?.assistantId) ?? null
  const referenceCount = messages.reduce((sum, message) => sum + (message.references?.length ?? 0), 0)
  const modeLabel = busy ? '生成中' : mode === 'live' ? '真模型' : mode === 'local' ? '本地假流式' : '未发送'

  return (
    <div
      className={`app${sideCollapsed ? ' app--side-rail' : ''}${
        inspCollapsed ? ' app--insp-hidden' : ''
      }`}
    >
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        collapsed={sideCollapsed}
        onToggleCollapse={() => setSideCollapsed((value) => !value)}
        onSelect={setActiveId}
        onCreate={() => void createConversation()}
        onRemove={(id) => void removeConversation(id)}
        onOpenAssistants={() => setDrawer('assistants')}
        onOpenWorkspace={() => setDrawer('workspace')}
        onOpenSettings={() => setDrawer('settings')}
        onExport={() => void exportConversation()}
      />

      <main className="main" style={{ ['--content-w' as string]: `${contentWidth}px` }}>
        <header className="topbar">
          <h1 className="topbar__title">{activeConversation?.title ?? 'PointStudio'}</h1>
          <span className="topbar__spacer" />

          <select
            className="chip"
            value={activeConversation?.assistantId ?? ''}
            onChange={(event) => void bindAssistant(event.target.value)}
            disabled={!activeId}
            title="当前会话使用的助手"
            style={{ height: 26 }}
          >
            <option value="">不使用助手</option>
            {assistants.map((assistant) => (
              <option key={assistant.id} value={assistant.id}>
                {assistant.name}
              </option>
            ))}
          </select>

          <button
            className="icon-btn"
            type="button"
            onClick={() => setDrafting((value) => !value)}
            title="快速新建助手"
            aria-label="快速新建助手"
          >
            ＋
          </button>

          <span
            className={`chip${mode === 'live' ? ' chip--live' : ''}${
              busy ? ' chip--busy' : ''
            }`}
            title={mode === 'live' ? 'API Key 已配置，走真实模型' : '没有 Key 时走本地假流式'}
          >
            <i className="chip__dot" />
            {modeLabel}
          </span>

          {lastRunMs !== null ? (
            <span className="chip" title="上一轮生成耗时">
              {formatMs(lastRunMs)}
            </span>
          ) : null}

          {/* ANNOTATE：标注模式开关。要关掉这个功能，注释掉下面这一个按钮即可 */}
          <button
            className={`icon-btn${annotate ? ' icon-btn--on' : ''}`}
            type="button"
            data-annot-skip=""
            onClick={() => setAnnotate((value) => !value)}
            title={annotate ? '退出标注模式' : '标注模式：点界面元素写意见'}
            aria-label="切换标注模式"
          >
            ✎
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

        {drafting ? (
          <div className="assistant-form">
            <input
              value={assistantName}
              placeholder="助手名称"
              onChange={(event) => setAssistantName(event.target.value)}
            />
            <input
              value={assistantPrompt}
              placeholder="系统提示（可选）：例如「你是严格的代码审查员」"
              onChange={(event) => setAssistantPrompt(event.target.value)}
            />
            <button className="btn-send" type="button" onClick={() => void createAssistant()}>
              保存
            </button>
          </div>
        ) : null}

        {info ? <div className="banner banner--info">{info}</div> : null}
        {error ? <div className="banner banner--error">{error}</div> : null}

        {messages.length === 0 ? (
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
                  setContentWidth(Math.min(1400, Math.max(480, next)))
                }}
                onPointerUp={(event) => {
                  resizeStart.current = null
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onDoubleClick={() => setContentWidth(720)}
              />
              <EmptyState mode={mode} onPick={(text) => setDraft(text)} />
            </div>
          </div>
        ) : (
          <div className="stream" ref={listRef}>
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
                  setContentWidth(Math.min(1400, Math.max(480, next)))
                }}
                onPointerUp={(event) => {
                  resizeStart.current = null
                  event.currentTarget.releasePointerCapture(event.pointerId)
                }}
                onDoubleClick={() => setContentWidth(720)}
              />
              {messages.map((message, index) => (
                <MessageBubble
                  key={message.id}
                  index={index}
                  role={message.role}
                  content={message.content}
                  streaming={message.status === 'streaming'}
                  failed={message.status === 'error'}
                  references={message.references}
                  onReference={(chunkId) => void openReference(chunkId)}
                  onCopy={() => void copyText(message.content)}
                  onDelete={() => void removeTurn(message.id)}
                  {...(message.role === 'user'
                    ? { onResend: () => void submit(message.content) }
                    : {})}
                />
              ))}
            </div>
          </div>
        )}

        <Composer
          draft={draft}
          busy={busy}
          canSend={!busy && draft.trim() !== '' && activeId !== null}
          model={
            activeConversation?.model ?? provider?.model ?? ''
          }
          models={modelChoices(
            provider?.providerId ?? null,
            activeConversation?.model ?? provider?.model ?? null
          )}
          effort={effortFromMaxTokens(
            activeConversation?.params?.maxTokens ?? provider?.params?.maxTokens
          )}
          onDraftChange={setDraft}
          onModelChange={(next) => void applyModel({ model: next === '' ? null : next })}
          onEffortChange={(level: Effort) =>
            void applyModel({ params: { maxTokens: EFFORT_MAX_TOKENS[level] } })
          }
          onSend={() => void submit()}
          onStop={() => {
            if (inflightId) {
              void window.pointstudio.chat.cancel(inflightId)
            }
          }}
          onPlan={() => void runPlan()}
        />
      </main>

      <Inspector
        tab={inspTab}
        onTab={setInspTab}
        collapsed={inspCollapsed}
        onToggleCollapsed={() => setInspCollapsed(true)}
        conversationTitle={activeConversation?.title ?? null}
        assistantName={boundAssistant?.name ?? null}
        mode={mode}
        messageCount={messages.length}
        referenceCount={referenceCount}
        provider={provider}
        lastRunMs={lastRunMs}
        planRun={planRun}
        mcpConnections={mcpConnections}
      />

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
            {drawer === 'assistants' ? (
              <AssistantPanel onClose={closeDrawer} onChanged={() => void refreshAssistants()} />
            ) : null}
            {drawer === 'workspace' ? <WorkspacePanel onClose={closeDrawer} /> : null}
            {drawer === 'plan' ? (
              planRun?.plan ? (
                <PlanPanel
                  plan={planRun.plan}
                  status={planRun.status}
                  details={planRun.details}
                  onClose={() => setDrawer(null)}
                  onConfirm={
                    planRun.status === 'stopped' ? () => void confirmAndResume() : undefined
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
