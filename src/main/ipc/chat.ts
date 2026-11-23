// ipc/chat —— 聊天域的跨进程边界。
//
// 这一层只做三件事：校验参数 → 委托业务 → 映射错误。不放业务判断。
// 注意推流模型：`invoke` 是「一问一答」，返回不了流。所以 send 立刻返回，
// 后续内容用 webContents.send 一块块推回去，渲染进程按 id 归并。
import { ipcMain, type WebContents } from 'electron'

import {
  CHAT_CHANNELS,
  type ChatChunkEvent,
  type ChatDoneEvent,
  type ChatErrorEvent,
  type ChatSendRequest,
  type ChatSendResult
} from '../../shared/types/ipc.ts'
import { ProviderError } from '../ai/providers/types.ts'
import { REPLY_CHUNK_DELAY_MS } from '../services/chatReply.ts'
import { resolveMode, streamReplyText, type ChatEngineDeps } from '../services/chatEngine.ts'

/** 请求 id 的允许形态：渲染进程用 crypto.randomUUID() 生成。 */
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
    typeof candidate.text === 'string' &&
    candidate.text.length <= MAX_TEXT_LENGTH
  )
}

/** provider 的错误码 → 边界的错误码。原始码只进日志，不透给界面。 */
function toChatErrorCode(error: unknown): 'E_UPSTREAM' | 'E_INTERNAL' {
  return error instanceof ProviderError ? 'E_UPSTREAM' : 'E_INTERNAL'
}

export interface ChatIpcOptions {
  engine: ChatEngineDeps
}

/** 注册聊天域的通道。由组合根（src/main/index.ts）在窗口就绪前调用一次。 */
export function registerChatIpc(options: ChatIpcOptions): void {
  ipcMain.handle(CHAT_CHANNELS.send, (event, request: unknown): ChatSendResult => {
    if (!isChatSendRequest(request)) {
      return { ok: false, code: 'E_BAD_INPUT' }
    }

    // 故意不 await：把流交给后台跑，handler 立刻返回，界面不用干等一整段回复。
    void streamReply(event.sender, request, options.engine)
    return { ok: true, mode: resolveMode(options.engine) }
  })
}

/** 把一块块内容推回渲染进程；发送方窗口已销毁就静默结束。 */
async function streamReply(
  sender: WebContents,
  request: ChatSendRequest,
  engine: ChatEngineDeps
): Promise<void> {
  const { id, text } = request
  try {
    for await (const chunk of streamReplyText(text, engine)) {
      if (sender.isDestroyed()) {
        return
      }
      sender.send(CHAT_CHANNELS.chunk, { id, chunk } satisfies ChatChunkEvent)
      // 真模型的节奏由平台决定，不再人为加间隔；只有本地假流式需要模拟打字。
      if (resolveMode(engine) === 'local') {
        await delay(REPLY_CHUNK_DELAY_MS)
      }
    }
    if (!sender.isDestroyed()) {
      sender.send(CHAT_CHANNELS.done, { id } satisfies ChatDoneEvent)
    }
  } catch (error) {
    // 中断是用户行为，不算错误。
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
