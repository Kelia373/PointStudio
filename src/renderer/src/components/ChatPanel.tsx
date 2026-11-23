import { useEffect, useRef, useState } from 'react'

import type { ChatMode } from '../../../shared/types/ipc.ts'
import MessageBubble, { type ChatMessage } from './MessageBubble'

/**
 * 聊天面板：本切片唯一有状态的界面组件。
 *
 * 职责边界：它只负责「显示 + 收集输入 + 订阅推流事件」。
 * 它不知道回复怎么生成，也不直接碰模型、文件、数据库——那些都在主进程。
 */
export default function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  // 这次到底走了真模型还是本地假回复：由主进程随 send 的结果返回，不靠界面猜。
  const [mode, setMode] = useState<ChatMode | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 订阅主进程推回来的事件。返回的清理函数必须调用：
  // React 严格模式会把 effect 跑两遍，不解绑就会重复订阅、每个字被追加两次。
  useEffect(() => {
    const offChunk = window.pointstudio.chat.onChunk(({ id, chunk }) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: m.text + chunk } : m)))
    })

    const offDone = window.pointstudio.chat.onDone(({ id }) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, streaming: false } : m)))
      setBusy(false)
    })

    const offError = window.pointstudio.chat.onError(({ id, code }) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === id ? { ...m, text: `（出错了：${code}）`, streaming: false } : m
        )
      )
      setBusy(false)
    })

    return () => {
      offChunk()
      offDone()
      offError()
    }
  }, [])

  // 新内容到达就滚到底部。
  useEffect(() => {
    const list = listRef.current
    if (list) {
      list.scrollTop = list.scrollHeight
    }
  }, [messages])

  async function submit(): Promise<void> {
    const text = draft.trim()
    if (text === '' || busy) {
      return
    }

    // id 在这里生成：先挂一条空的 assistant 消息，chunk 一到就有归属，不会错位。
    const id = crypto.randomUUID()
    setMessages((prev) => [
      ...prev,
      { id: `user-${id}`, role: 'user', text, streaming: false },
      { id, role: 'assistant', text: '', streaming: true }
    ])
    setDraft('')
    setBusy(true)

    const result = await window.pointstudio.chat.send({ id, text })
    if (result.ok) {
      setMode(result.mode)
    }
    if (!result.ok) {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, text: `（出错了：${result.code}）`, streaming: false } : m))
      )
      setBusy(false)
    }
  }

  return (
    <section className="chat">
      <header className="chat__header">
        <h1>PointStudio</h1>
        <span className="chat__hint">
          {busy
            ? '正在回复…'
            : mode === 'live'
              ? 'DeepSeek · 真模型'
              : mode === 'local'
                ? '本地假流式 · 未配 Key'
                : '按 Enter 发送'}
        </span>
      </header>

      <div className="chat__list" ref={listRef}>
        {messages.length === 0 ? (
          <p className="chat__empty">
            说点什么。配了 API Key 就直接问 DeepSeek；没配 Key 则走本地假流式，链路一样是通的。
          </p>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
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
        <button className="chat__send" type="submit" disabled={busy || draft.trim() === ''}>
          发送
        </button>
      </form>
    </section>
  )
}
