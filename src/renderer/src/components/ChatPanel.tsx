import { useCallback, useEffect, useRef, useState } from 'react'

import type { AssistantDto, ChatMode, ConversationDto } from '../../../shared/types/ipc.ts'
import ConversationList from './ConversationList'
import SettingsPanel from './SettingsPanel'
import MessageBubble, { type BubbleRole } from './MessageBubble'

/** 界面侧的消息形态：比持久化多一个「正在流式」的中间状态。 */
interface UiMessage {
  id: string
  role: BubbleRole
  content: string
  status: 'complete' | 'error' | 'streaming'
}

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
  const [mode, setMode] = useState<ChatMode | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [assistants, setAssistants] = useState<AssistantDto[]>([])
  const [drafting, setDrafting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const loadMessages = useCallback(async (conversationId: string): Promise<void> => {
    const stored = await window.pointstudio.conversations.messages(conversationId)
    setMessages(
      stored.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        status: message.status
      }))
    )
  }, [])

  // 订阅主进程推回来的流式事件。返回的清理函数必须调用，否则会重复追加。
  useEffect(() => {
    const offChunk = window.pointstudio.chat.onChunk(({ id, chunk }) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: m.content + chunk } : m))
      )
    })

    const offDone = window.pointstudio.chat.onDone(({ id }) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'complete' } : m)))
      setBusy(false)
      // 落库完成，用磁盘上的版本覆盖界面。
      const current = activeIdRef.current
      if (current) {
        void loadMessages(current)
        void reloadConversations()
      }
    })

    const offNotice = window.pointstudio.chat.onNotice(({ droppedCount }) => {
      setError(`已省略较早的 ${droppedCount} 条消息（超出上下文窗口）`)
    })

    const offError = window.pointstudio.chat.onError(({ id, code }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, status: 'error', content: m.content || `（出错了：${code}）` } : m
        )
      )
      setBusy(false)
    })

    return () => {
      offChunk()
      offDone()
      offNotice()
      offError()
    }
  }, [loadMessages, reloadConversations])

  // 首次进入：有会话就用最近一个，没有就建一个。
  useEffect(() => {
    void (async () => {
      setAssistants(await window.pointstudio.assistants.list())
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
        setError(created.code)
      }
    })()
  }, [reloadConversations])

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

  async function submit(): Promise<void> {
    const text = draft.trim()
    const conversationId = activeId
    if (text === '' || busy || !conversationId) {
      return
    }

    const requestId = crypto.randomUUID()
    // 乐观渲染：用户消息与空气泡先上屏，chunk 到达即可追加。
    setMessages((prev) => [
      ...prev,
      { id: `local-${requestId}`, role: 'user', content: text, status: 'complete' },
      { id: requestId, role: 'assistant', content: '', status: 'streaming' }
    ])
    setDraft('')
    setBusy(true)

    const result = await window.pointstudio.chat.send({ id: requestId, conversationId, text })
    if (result.ok) {
      setMode(result.mode)
      return
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === requestId ? { ...m, status: 'error', content: `（出错了：${result.code}）` } : m
      )
    )
    setBusy(false)
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
      setError(bound.code)
      return
    }
    setError(null)
    await reloadConversations()
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
      setError(created.code)
      return
    }
    setAssistantName('')
    setAssistantPrompt('')
    setDrafting(false)
    setError(null)
    setAssistants(await window.pointstudio.assistants.list())
    if (activeId) {
      await bindAssistant(created.value.id)
    }
  }

  async function createConversation(): Promise<void> {
    const created = await window.pointstudio.conversations.create({})
    if (!created.ok) {
      setError(created.code)
      return
    }
    await reloadConversations()
    setActiveId(created.value.id)
  }

  async function removeConversation(id: string): Promise<void> {
    const removed = await window.pointstudio.conversations.remove(id)
    if (!removed.ok) {
      setError(removed.code)
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
            onClick={() => setSettingsOpen((value) => !value)}
          >
            ⚙ 设置
          </button>
          <span className="chat__hint">{hint}</span>
          {error ? <span className="chat__error">{error}</span> : null}
        </header>

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
          <button
            className="chat__send"
            type="submit"
            disabled={busy || draft.trim() === '' || !activeId}
          >
            发送
          </button>
        </form>
      </section>
    </div>
  )
}
