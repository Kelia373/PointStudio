// renderer/lib/chatState —— 聊天界面的状态转换。
//
// 为什么单独抽出来：流式渲染的 bug 几乎都藏在「按 id 归并 chunk」「结束时改状态」
// 这类操作里，而它们此前埋在组件中，无法测试（组件的渲染要 DOM，本仓库没有 jsdom）。
// 抽成纯函数后：不依赖 DOM 也能测，组件只剩「调函数 + 渲染」。
//
// 约定：所有函数**返回新数组**，不修改入参——React 靠引用变化判断是否重渲染。

import type { RouteDecisionDto, HandoffEnvelopeDto } from '../../../shared/types/ipc.ts'

export type UiMessageStatus = 'complete' | 'error' | 'streaming'

export interface UiMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: UiMessageStatus
  references?: Array<{ chunkId: string; source: string }>
  /** 主进程返回的路由决策；没有就是没记录。 */
  route?: RouteDecisionDto | null
  /** 归属任务链；普通对话没有。 */
  missionId?: string | null
  /** 交接卡；有值时主群渲染成一行胶囊。 */
  handoff?: HandoffEnvelopeDto | null
  /** 模型思考内容 */
  reasoning?: string
  reasoningMs?: number
}

/**
 * 开始一轮对话：用户消息立刻上屏，助手气泡先占位（id 用请求 id）。
 * 选了「🐼 Auto · 协同路由」时把这一轮的决策挂在助手气泡上，
 * 徽章与「升档重试」都从这里读，不必等主进程回包。
 */
export function startTurn(
  messages: UiMessage[],
  input: { requestId: string; text: string; route?: RouteDecisionDto | null }
): UiMessage[] {
  return [
    ...messages,
    { id: `local-${input.requestId}`, role: 'user', content: input.text, status: 'complete' },
    {
      id: input.requestId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      route: input.route ?? null
    }
  ]
}

/** 追加一块增量文本；未知 id 直接忽略。 */
/** 追加模型思考增量（不影响 content）。 */
export function appendReasoning(messages: UiMessage[], id: string, chunk: string): UiMessage[] {
  let touched = false
  const next = messages.map((message) => {
    if (message.id !== id) {
      return message
    }
    touched = true
    return { ...message, reasoning: (message.reasoning ?? '') + chunk }
  })
  return touched ? next : messages
}

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
