// ipc/chat —— 聊天域的跨进程边界。
//
// 这一层只做三件事：校验参数 → 委托业务 → 映射错误。不放业务判断。
// 推流模型：`invoke` 是「一问一答」，返回不了流。所以 send 立刻返回，
// 后续内容用 webContents.send 一块块推回去，渲染进程按 id 归并。
import { ipcMain, type WebContents } from 'electron'

import {
  CHAT_CHANNELS,
  type ChatChunkEvent,
  type ChatDoneEvent,
  type ChatErrorEvent,
  type ChatNoticeEvent,
  type ChatSendRequest,
  type ChatSendResult
} from '../../shared/types/ipc.ts'
import { ProviderError } from '../ai/providers/types.ts'
import { REPLY_CHUNK_DELAY_MS } from '../services/chatReply.ts'
import { resolveMode, type ChatEngineDeps } from '../services/chatEngine.ts'
import type { SearchHit } from '../ai/domain/search.ts'
import { streamAssistantReply, type AssistantLookup } from '../services/chatFlow.ts'
import type { ConversationService } from '../services/conversationService.ts'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TEXT_LENGTH = 8_000

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 运行时校验。TypeScript 的类型在进程边界上是**不存在**的，
 * 渲染进程传进来什么都有可能，所以必须真的验一遍。
 */
function isChatSendRequest(value: unknown): value is ChatSendRequest {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<ChatSendRequest>
  return (
    typeof candidate.id === 'string' &&
    ID_PATTERN.test(candidate.id) &&
    typeof candidate.conversationId === 'string' &&
    ID_PATTERN.test(candidate.conversationId) &&
    typeof candidate.text === 'string' &&
    candidate.text.length <= MAX_TEXT_LENGTH
  )
}

function toChatErrorCode(error: unknown): 'E_UPSTREAM' | 'E_INTERNAL' {
  return error instanceof ProviderError ? 'E_UPSTREAM' : 'E_INTERNAL'
}

export interface ChatIpcOptions {
  engine: ChatEngineDeps
  conversations: ConversationService
  assistants: AssistantLookup
  /** 可选：工作区检索。不注入则对话不引用任何文件。 */
  retrieval?: { search(query: string): Promise<SearchHit[]> }
}

/** 注册聊天域的通道。由组合根（src/main/index.ts）在窗口就绪前调用一次。 */
export function registerChatIpc(options: ChatIpcOptions): void {
  ipcMain.handle(CHAT_CHANNELS.send, (event, request: unknown): ChatSendResult => {
    if (!isChatSendRequest(request)) {
      return { ok: false, code: 'E_BAD_INPUT' }
    }

    void streamReply(event.sender, request, options)
    return { ok: true, mode: resolveMode(options.engine) }
  })
}

/** 把一块块内容推回渲染进程；发送方窗口已销毁就静默结束。 */
async function streamReply(
  sender: WebContents,
  request: ChatSendRequest,
  options: ChatIpcOptions
): Promise<void> {
  const { id, conversationId, text } = request
  try {
    for await (const chunk of streamAssistantReply(conversationId, text, {
      conversations: options.conversations,
      assistants: options.assistants,
      engine: options.engine,
      retrieval: options.retrieval,
      onContextTrimmed: (droppedCount) => {
        if (!sender.isDestroyed()) {
          sender.send(CHAT_CHANNELS.notice, { id, droppedCount } satisfies ChatNoticeEvent)
        }
      }
    })) {
      if (sender.isDestroyed()) {
        return
      }
      sender.send(CHAT_CHANNELS.chunk, { id, chunk } satisfies ChatChunkEvent)
      if (resolveMode(options.engine) === 'local') {
        await delay(REPLY_CHUNK_DELAY_MS)
      }
    }
    if (!sender.isDestroyed()) {
      sender.send(CHAT_CHANNELS.done, { id } satisfies ChatDoneEvent)
    }
  } catch (error) {
    // 中断是用户行为，不算错误；已产出的部分和状态由 chatFlow 负责落库。
    if (error instanceof ProviderError && error.code === 'E_ABORTED') {
      if (!sender.isDestroyed()) {
        sender.send(CHAT_CHANNELS.done, { id } satisfies ChatDoneEvent)
      }
      return
    }
    console.error('[chat] 推流失败', error)
    if (!sender.isDestroyed()) {
      sender.send(CHAT_CHANNELS.error, {
        id,
        code: toChatErrorCode(error)
      } satisfies ChatErrorEvent)
    }
  }
}
