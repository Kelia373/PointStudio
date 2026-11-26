// renderer/lib/chatState —— 聊天界面的状态转换。
//
// 为什么单独抽出来：流式渲染的 bug 几乎都藏在「按 id 归并 chunk」「结束时改状态」
// 这类操作里，而它们此前埋在组件中，无法测试（组件的渲染要 DOM，本仓库没有 jsdom）。
// 抽成纯函数后：不依赖 DOM 也能测，组件只剩「调函数 + 渲染」。
//
// 约定：所有函数**返回新数组**，不修改入参——React 靠引用变化判断是否重渲染。

import type { RouteDecisionDto } from '../../../shared/types/ipc.ts'

export type UiMessageStatus = 'complete' | 'error' | 'streaming'

export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: UiMessageStatus
  references?: Array<{ chunkId: string; source: string }>
  /** 主进程返回的路由决策；没有就是没记录。 */
  route?: RouteDecisionDto | null
}

/** 开始一轮对话：用户消息立刻上屏，助手气泡先占位（id 用请求 id）。 */
export function startTurn(
  messages: UiMessage[],
  input: { requestId: string; text: string }
): UiMessage[] {
  return [
    ...messages,
    { id: `local-${input.requestId}`, role: 'user', content: input.text, status: 'complete' },
    { id: input.requestId, role: 'assistant', content: '', status: 'streaming' }
  ]
}

/** 追加一块增量文本；未知 id 直接忽略。 */
export function appendChunk(messages: UiMessage[], id: string, chunk: string): UiMessage[] {
  let touched = false
  const next = messages.map((message) => {
    if (message.id !== id) {
      return message
    }
    touched = true
    return { ...message, content: message.content + chunk }
  })
  return touched ? next : messages
}

/**
 * 结束一条消息。错误且没有任何内容时补占位文案——
 * 界面上一条空白气泡比一句"出错了"更难理解。
 */
export function markStatus(
  messages: UiMessage[],
  id: string,
  status: UiMessageStatus,
  placeholder = '（出错了）'
): UiMessage[] {
  let touched = false
  const next = messages.map((message) => {
    if (message.id !== id) {
      return message
    }
    touched = true
    const needsPlaceholder = status === 'error' && message.content === ''
    return {
      ...message,
      status,
      content: needsPlaceholder ? placeholder : message.content
    }
  })
  return touched ? next : messages
}

export function removeMessage(messages: UiMessage[], id: string): UiMessage[] {
  const next = messages.filter((message) => message.id !== id)
  return next.length === messages.length ? messages : next
}
