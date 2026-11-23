import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  AssistantDto,
  ChatMode,
  ConversationDto,
  PlanViewDto
} from '../../../shared/types/ipc.ts'
import { describeError } from '../../../shared/i18n/errors.ts'
import { appendChunk, markStatus, startTurn, type UiMessage } from '../lib/chatState'
import { pendingHighRiskStepIds } from '../lib/planConfirm'
import ConversationList from './ConversationList'
import SettingsPanel from './SettingsPanel'
import AssistantPanel from './AssistantPanel'
import PlanPanel from './PlanPanel'
import WorkspacePanel from './WorkspacePanel'
import MessageBubble from './MessageBubble'


/**
 * 聊天面板：会话列表 + 消息流。
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
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [assistantPanelOpen, setAssistantPanelOpen] = useState(false)
  const [planRun, setPlanRun] = useState<{
    id: string
    plan: PlanViewDto | null
    status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  } | null>(null)
  const [assistantName, setAssistantName] = useState('')
  const [assistantPrompt, setAssistantPrompt] = useState('')

  const listRef = useRef<HTMLDivElement>(null)
  const activeIdRef = useRef<string | null>(null)
  activeIdRef.current = activeId

  const reloadConversations = useCallback(async (): Promise<ConversationDto[]> => {
    const items = await window.pointstudio.conversations.list()
    setConversations(items)
    return items
  }, [])

  const refreshAssistants = useCallback(async (): Promise<void> => {
    setAssistants(await window.pointstudio.assistants.list())
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
      // 落库完成，用磁盘上的版本覆盖界面。
      const current = activeIdRef.current
      if (current) {
        void loadMessages(current)
        void reloadConversations()
      }
    })

    const offAgent = window.pointstudio.agent.onEvent((event) => {
      setPlanRun((current) => {
        if (!current) {
          return current
        }
        if (event.type === 'plan' || event.type === 'step') {
          return { ...current, plan: event.plan, status: 'running' }
        }
        if (event.type === 'done') {
          return { ...current, plan: event.plan, status: event.status }
        }
        if (event.type === 'error') {
          return { ...current, status: 'failed' }
        }
        return current
      })
    })

    const offNotice = window.pointstudio.chat.onNotice(({ droppedCount }) => {
      setError(`已省略较早的 ${droppedCount} 条消息（超出上下文窗口）`)
    })

    const offError = window.pointstudio.chat.onError(({ id, code }) => {
      setMessages((prev) => markStatus(prev, id, 'error', `（${describeError(code)}）`))
      setBusy(false)
      setInflightId(null)
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
      await refreshAssistants()
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
  }, [refreshAssistants, reloadConversations])

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

    const result = await window.pointstudio.chat.send({ id: requestId, conversationId, text })
    if (result.ok) {
      setMode(result.mode)
      return
    }
    setMessages((prev) => markStatus(prev, requestId, 'error', `（${describeError(result.code)}）`))
    setBusy(false)
    setInflightId(null)
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

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
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

  const hint = busy
    ? '正在回复…'
    : mode === 'live'
      ? 'DeepSeek · 真模型'
      : mode === 'local'
        ? '本地假流式 · 未配 Key'
        : '按 Enter 发送'

  return (
    <div className="layout">
      <ConversationList
        conversations={conversations}
        activeId={activeId}
        onSelect={setActiveId}
        onCreate={() => void createConversation()}
        onRemove={(id) => void removeConversation(id)}
      />

      <section className="chat">
        <header className="chat__header">
          <h1>PointStudio</h1>
          <select
            className="chat__assistant"
            value={conversations.find((c) => c.id === activeId)?.assistantId ?? ''}
            onChange={(event) => void bindAssistant(event.target.value)}
            disabled={!activeId}
          >
            <option value="">不使用助手</option>
            {assistants.map((assistant) => (
              <option key={assistant.id} value={assistant.id}>
                {assistant.name}
              </option>
            ))}
          </select>
          <button
            className="chat__assistant-new"
            type="button"
            onClick={() => setDrafting((value) => !value)}
          >
            ＋助手
          </button>
          <button
            className="chat__assistant-new"
            type="button"
            onClick={() => void runPlan()}
            disabled={draft.trim() === '' || planRun?.status === 'running'}
          >
            🧭 计划
          </button>
          <button
            className="chat__assistant-new"
            type="button"
            onClick={() => setAssistantPanelOpen((value) => !value)}
          >
            👤 助手管理
          </button>
          <button
            className="chat__assistant-new"
            type="button"
            onClick={() => setWorkspaceOpen((value) => !value)}
          >
            📁 工作区
          </button>
          <button
            className="chat__assistant-new"
            type="button"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            ⚙ 设置
          </button>
          <span className="chat__hint">{hint}</span>
          <button
            className="chat__assistant-new"
            type="button"
            onClick={() => void exportConversation()}
            disabled={!activeId}
          >
            ⤓ 导出
          </button>
          {info ? <span className="chat__info">{info}</span> : null}
          {error ? <span className="chat__error">{error}</span> : null}
        </header>

        {planRun?.plan ? (
          <PlanPanel
            plan={planRun.plan}
            status={planRun.status}
            onClose={() => setPlanRun(null)}
            onConfirm={planRun.status === 'stopped' ? () => void confirmAndResume() : undefined}
          />
        ) : null}

        {assistantPanelOpen ? (
          <AssistantPanel
            onClose={() => setAssistantPanelOpen(false)}
            onChanged={() => void refreshAssistants()}
          />
        ) : null}

        {workspaceOpen ? <WorkspacePanel onClose={() => setWorkspaceOpen(false)} /> : null}

        {settingsOpen ? <SettingsPanel onClose={() => setSettingsOpen(false)} /> : null}

        {drafting ? (
          <div className="assistant-form">
            <input
              className="assistant-form__name"
              value={assistantName}
              placeholder="助手名称"
              onChange={(event) => setAssistantName(event.target.value)}
            />
            <input
              className="assistant-form__prompt"
              value={assistantPrompt}
              placeholder="系统提示（可选）：例如「你是严格的代码审查员」"
              onChange={(event) => setAssistantPrompt(event.target.value)}
            />
            <button className="assistant-form__save" type="button" onClick={() => void createAssistant()}>
              保存
            </button>
          </div>
        ) : null}

        <div className="chat__list" ref={listRef}>
          {messages.length === 0 ? (
            <p className="chat__empty">
              说点什么。配了 API Key 就直接问 DeepSeek；没配 Key 则走本地假流式，链路一样是通的。
            </p>
          ) : (
            messages.map((message) => (
              <MessageBubble
                key={message.id}
                role={message.role}
                content={message.content}
                streaming={message.status === 'streaming'}
                failed={message.status === 'error'}
                references={message.references}
                onCopy={() => void copyText(message.content)}
                onDelete={() => void removeTurn(message.id)}
                {...(message.role === 'user'
                  ? { onResend: () => void submit(message.content) }
                  : {})}
              />
            ))
          )}
        </div>

        <form
          className="chat__composer"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <textarea
            className="chat__input"
            value={draft}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={2}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          {busy && inflightId ? (
            <button
              className="chat__send"
              type="button"
              onClick={() => void window.pointstudio.chat.cancel(inflightId)}
            >
              停止
            </button>
          ) : (
            <button
              className="chat__send"
              type="submit"
              disabled={busy || draft.trim() === '' || !activeId}
            >
              发送
            </button>
          )}
        </form>
      </section>
    </div>
  )
}
