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
import { capabilitiesForSend } from '../ai/providers/modelCapabilities.ts'
import type { ImageMimeTypeDto, MessageImageDto } from '../../shared/types/ipc.ts'

/** 把消息里的附图 id 读成 base64；读不出来的单张直接跳过（不崩整条会话）。 */
async function readImages(
  deps: ChatFlowDeps,
  images: MessageImageDto[] | undefined
): Promise<Array<{ mimeType: ImageMimeTypeDto; base64: string }>> {
  if (!images || images.length === 0 || !deps.readImage) {
    return []
  }
  const out: Array<{ mimeType: ImageMimeTypeDto; base64: string }> = []
  for (const image of images) {
    try {
      const read = await deps.readImage(image.id)
      if (read !== null) {
        out.push({ mimeType: read.mimeType, base64: read.base64 })
      }
    } catch {
      continue
    }
  }
  return out
}

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
  /** 真实用量落账本；不注入则不记录。 */
  onUsageRecorded?: (record: {
    providerId: string
    modelId: string
    assistantId: string | null
    conversationId: string
    promptTokens: number
    completionTokens: number
    cacheHitTokens: number
    totalTokens: number
  }) => void | Promise<void>
  /** 群聊 @ 成员：本轮由该 Agent 接管，缺省用会话绑定的 Agent。 */
  assistantOverride?: string | null
  /** 读取附图 base64（缺省表示不支持图片：带图时按读不出处理）。 */
  readImage?: (
    id: string
  ) => Promise<{ base64: string; mimeType: ImageMimeTypeDto } | null>
  /** 思考增量：转给界面实时展示。 */
  onReasoning?: (delta: string) => void
  /** 真实用量：转给界面检查器（账本另走 onUsageRecorded）。 */
  onUsageSample?: (sample: {
    promptTokens: number
    completionTokens: number
    cacheHitTokens: number
    totalTokens: number
  }) => void
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
  const boundAssistantId = deps.assistantOverride ?? conversation.assistantId
  let assistant = boundAssistantId ? await deps.assistants.get(boundAssistantId) : null
  // 被 @ 的成员已停用（或不存在）时回落会话绑定的 Agent，不把活派给停用的人。
  if (deps.assistantOverride && (assistant === null || assistant.enabled === false)) {
    assistant = conversation.assistantId
      ? await deps.assistants.get(conversation.assistantId)
      : null
  }

  const conversationParams = conversation.params ?? {}
  const assistantParams = assistant?.params ?? {}
  const params = { ...assistantParams, ...conversationParams }

  const model = conversation.model ?? assistant?.modelId ?? undefined
  // 服务商优先级与会话模型一致：会话覆盖 > 助手绑定 > 引擎默认。
  const providerId = conversation.providerId ?? assistant?.providerId ?? null

  const options: ReplyOptions = {
    model,
    providerId,
    sessionId: conversationId,
    resolvedAssistantId: assistant?.id ?? null
  }
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
  deps: ChatFlowDeps,
  images: MessageImageDto[] = []
): AsyncGenerator<string, void, unknown> {
  const conversation = await deps.conversations.get(conversationId)
  if (!conversation) {
    throw new Error('E_NOT_FOUND')
  }

  // 先取历史（此时还没有本轮这条），再落用户消息——顺序反了就会把本轮算进历史，
  // 模型会看到同一句话两遍。
  const previous = await deps.conversations.listMessages(conversationId)
  const bound = await resolveReplyOptions(conversationId, deps)

  // 视觉拦截在落库之前：模型明确不吃图就直接拒，用户输入框里的草稿和图片都还在。
  // 注意：内置助手的 providerId / modelId 都是 null，这里必须回落到引擎默认值，
  // 否则「没显式配模型」的默认路径会直接跳过拦截。
  if (images.length > 0) {
    const providerId = bound.providerId ?? deps.engine.provider.id
    const model = bound.model ?? deps.engine.model
    if (providerId && model) {
      const caps = capabilitiesForSend(providerId, model)
      if (caps.supportsVision === false) {
        throw new Error('E_VISION_UNSUPPORTED')
      }
    }
  }

  const history: ContextMessage[] = []
  for (const message of previous) {
    const past = await readImages(deps, message.images)
    history.push({
      role: message.role,
      content: message.content,
      ...(past.length > 0 ? { images: past } : {})
    })
  }
  const userImages = await readImages(deps, images)
  if (images.length > 0 && userImages.length === 0) {
    // 一张都读不出来（文件被清掉 / 尚未落盘）时不能假装没事：直接报错更好排查。
    throw new Error('E_IMAGE_UNREADABLE')
  }

  const saved = await deps.conversations.appendMessage(conversationId, {
    role: 'user',
    content: prompt,
    ...(images.length > 0 ? { images } : {})
  })
  if (!saved.ok) {
    throw new Error(saved.errors[0] ?? 'E_UNKNOWN')
  }

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

  const options: ReplyOptions = {
    ...bound,
    history: trimmed.messages,
    references,
    signal: deps.signal,
    ...(userImages.length > 0 ? { userImages } : {})
  }
  options.onUsage = (sample) => {
    void deps.onUsageRecorded?.({
      providerId: sample.providerId,
      modelId: sample.model,
      assistantId: bound.resolvedAssistantId ?? null,
      conversationId,
      ...sample.usage
    })
    deps.onUsageSample?.(sample.usage)
  }

  let accumulated = ''
  let reasoningText = ''
  let reasoningStartedAt: number | null = null
  let reasoningEndedAt: number | null = null
  options.onReasoning = (delta) => {
    if (reasoningStartedAt === null) {
      reasoningStartedAt = Date.now()
    }
    reasoningText += delta
    deps.onReasoning?.(delta)
  }

  const reasoningFields = (): { reasoning?: string; reasoningMs?: number } => {
    if (reasoningText === '' || reasoningStartedAt === null) {
      return {}
    }
    const end = reasoningEndedAt ?? Date.now()
    return { reasoning: reasoningText, reasoningMs: Math.max(0, end - reasoningStartedAt) }
  }

  // 归因在写入时定死：之后换 Agent / 换模型，历史回复的署名不会被改写。
  const attributionFields = (): {
    assistantId?: string
    providerId?: string
    modelId?: string
  } => ({
    ...(bound.resolvedAssistantId ? { assistantId: bound.resolvedAssistantId } : {}),
    ...(bound.providerId ? { providerId: bound.providerId } : {}),
    ...(bound.model ? { modelId: bound.model } : {})
  })

  try {
    for await (const chunk of streamReplyText(prompt, deps.engine, options)) {
      if (reasoningStartedAt !== null && reasoningEndedAt === null) {
        reasoningEndedAt = Date.now()
      }
      accumulated += chunk
      yield chunk
    }
  } catch (error) {
    const content =
      accumulated !== '' ? accumulated : reasoningText !== '' ? '（思考已中断）' : '（回复失败）'
    await deps.conversations.appendMessage(conversationId, {
      role: 'assistant',
      content,
      status: 'error',
      references: referenceItems,
      ...attributionFields(),
      ...reasoningFields()
    })

    throw error
  }

  await deps.conversations.appendMessage(conversationId, {
    role: 'assistant',
    content: accumulated,
    references: referenceItems,
    ...attributionFields(),
    ...reasoningFields()
  })

}
