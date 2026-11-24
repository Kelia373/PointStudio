// services/chatFlow —— 一次问答的编排：先落用户消息，再流式产出，最后落助手消息。
//
// 为什么单独一层：它既不属于「怎么调模型」（chatEngine），也不属于「怎么存」
// （conversationService）。它决定的是顺序与失败语义——这部分最容易出错，
// 也最需要测试：用户消息不能因为模型报错就跟着丢掉。
import type { Assistant } from '../ai/domain/assistant.ts'
import { trimHistory, type ContextMessage } from '../ai/domain/context.ts'
import type { SearchHit } from '../ai/domain/search.ts'
import { formatHitsForPrompt } from './retrievalService.ts'
import type { ConversationService } from './conversationService.ts'
import { streamReplyText, type ChatEngineDeps, type ReplyOptions } from './chatEngine.ts'

/**
 * 只需要「按 id 取助手」这一个能力，所以不收 AssistantService 整个类。
 * 接口小一点，测试里给个桩就够，也让这层不关心助手怎么存。
 */
export interface AssistantLookup {
  get(id: string): Promise<Assistant | null>
}

/** 上下文窗口上限：条数与粗略 token 预算。超了从头丢，并在返回值里报出来。 */
export const CONTEXT_MAX_MESSAGES = 20
export const CONTEXT_MAX_TOKENS = 4_000

export interface ContextLimits {
  maxMessages: number
  maxTokens: number
}

export interface ChatFlowDeps {
  conversations: ConversationService
  assistants: AssistantLookup
  engine: ChatEngineDeps
  /** 覆盖默认上下文上限（测试用；生产用默认常量）。 */
  contextLimits?: ContextLimits
  /** 上下文被裁剪时回调，用于告诉用户丢了几条。 */
  onContextTrimmed?: (droppedCount: number) => void
  /** 可选的工作区检索；不注入则完全不做检索。 */
  retrieval?: { search(query: string): Promise<SearchHit[]> }
  /** 命中参考片段时回调，便于界面显示「引用了哪些文件」。 */
  onReferences?: (hits: SearchHit[]) => void
  /** 用户中断信号。 */
  signal?: AbortSignal
}

/** 把助手绑定翻译成引擎选项；助手不存在时返回空选项（降级为裸对话）。 */
async function resolveReplyOptions(
  conversationId: string,
  deps: ChatFlowDeps
): Promise<ReplyOptions> {
  const conversation = await deps.conversations.get(conversationId)
  if (!conversation) {
    return {}
  }

  // 优先级：会话级覆盖 > 助手设定 > 全局默认（引擎里再兜底）。
  // 模型是「这次执行用什么」，所以会话排在最前面。
  const assistant = conversation.assistantId
    ? await deps.assistants.get(conversation.assistantId)
    : null

  const conversationParams = conversation.params ?? {}
  const assistantParams = assistant?.params ?? {}
  const params = { ...assistantParams, ...conversationParams }

  const model = conversation.model ?? assistant?.modelId ?? undefined

  const options: ReplyOptions = { model }
  if (assistant?.systemPrompt) {
    options.systemPrompt = assistant.systemPrompt
  }
  if (Object.keys(params).length > 0) {
    options.params = params
  }
  return options
}

/**
 * 产出助手回复的增量文本，同时把这一轮问答写进会话。
 *
 * 失败语义：
 * - 会话不存在 → 抛错，什么都不写；
 * - 用户消息一定先落库，模型失败也不会丢用户说过的话；
 * - 回复中途失败 → 已产出的部分照常保留，助手消息标记 `error`。
 */
export async function* streamAssistantReply(
  conversationId: string,
  prompt: string,
  deps: ChatFlowDeps
): AsyncGenerator<string, void, unknown> {
  const conversation = await deps.conversations.get(conversationId)
  if (!conversation) {
    throw new Error('E_NOT_FOUND')
  }

  // 先取历史（此时还没有本轮这条），再落用户消息——顺序反了就会把本轮算进历史，
  // 模型会看到同一句话两遍。
  const previous = await deps.conversations.listMessages(conversationId)
  const history: ContextMessage[] = previous.map((message) => ({
    role: message.role,
    content: message.content
  }))

  const saved = await deps.conversations.appendMessage(conversationId, {
    role: 'user',
    content: prompt
  })
  if (!saved.ok) {
    throw new Error(saved.errors[0] ?? 'E_UNKNOWN')
  }

  const bound = await resolveReplyOptions(conversationId, deps)
  const limits = deps.contextLimits ?? {
    maxMessages: CONTEXT_MAX_MESSAGES,
    maxTokens: CONTEXT_MAX_TOKENS
  }
  const trimmed = trimHistory(history, limits)
  if (trimmed.droppedCount > 0) {
    deps.onContextTrimmed?.(trimmed.droppedCount)
  }
  // 检索是「锦上添花」：失败不该让整轮对话失败，退化为无参考资料。
  let references = ''
  let referenceItems: Array<{ chunkId: string; source: string }> = []
  if (deps.retrieval) {
    try {
      const hits = await deps.retrieval.search(prompt)
      if (hits.length > 0) {
        references = formatHitsForPrompt(hits)
        referenceItems = hits.map((hit) => ({ chunkId: hit.chunk.id, source: hit.chunk.source }))
        deps.onReferences?.(hits)
      }
    } catch {
      references = ''
    }
  }

  const options = { ...bound, history: trimmed.messages, references, signal: deps.signal }

  let accumulated = ''
  try {
    for await (const chunk of streamReplyText(prompt, deps.engine, options)) {
      accumulated += chunk
      yield chunk
    }
  } catch (error) {
    // 一行都没产出时给个占位，否则界面上会出现一条空白气泡。
    await deps.conversations.appendMessage(conversationId, {
      role: 'assistant',
      content: accumulated === '' ? '（回复失败）' : accumulated,
      status: 'error',
      references: referenceItems
    })
    throw error
  }

  await deps.conversations.appendMessage(conversationId, {
    role: 'assistant',
    content: accumulated,
    references: referenceItems
  })
}
