// 跨进程共享的类型与常量。
//
// 只允许放：type / interface / 常量 / 纯函数。不许放状态、单例、可变变量——
// 主进程和渲染进程各加载一次，所谓「共享单例」实际是两份互不相干的实例。
// 见 docs/references/architecture/shared-layer.md

/** 通道名集中在这里：两边引同一份，改名字只改一处。 */
export const CHAT_CHANNELS = {
  send: 'chat:send',
  chunk: 'chat:chunk',
  done: 'chat:done',
  error: 'chat:error'
} as const

/** 错误码是稳定契约：渲染进程按码判断，不解析文案、不看堆栈。 */
export type ChatErrorCode = 'E_BAD_INPUT' | 'E_INTERNAL' | 'E_UPSTREAM'

/**
 * `chat:send` 的请求。
 *
 * id 由**渲染进程**生成（crypto.randomUUID），不是主进程。原因：主进程开始推流后，
 * 第一块 chunk 可能比 invoke 的返回值更早到达渲染进程，界面这时还没拿到 id，
 * 就对不上号了。让发起方先定 id，界面可以乐观地先挂一条空消息，chunk 到达即有归属。
 */
export interface ChatSendRequest {
  id: string
  conversationId: string
  text: string
}

/**
 * `chat:send` 的返回值。
 *
 * 用「结果对象」而不是 throw：Electron 会把跨 IPC 抛出的 Error 改写成
 * "Error invoking remote method ..."，原始信息全丢。归一成错误码更好维护。
 */
/** mode 告诉界面这次走的是真模型（live）还是本地假回复（local）。 */
export type ChatMode = 'live' | 'local'

export type ChatSendResult = { ok: true; mode: ChatMode } | { ok: false; code: ChatErrorCode }

/** 一块增量文本。 */
export interface ChatChunkEvent {
  id: string
  chunk: string
}

/** 流结束。 */
export interface ChatDoneEvent {
  id: string
}

/** 流中途失败。 */
export interface ChatErrorEvent {
  id: string
  code: ChatErrorCode
}

/** preload 暴露给渲染进程的 chat 能力。 */
export interface ChatBridge {
  send(request: ChatSendRequest): Promise<ChatSendResult>
  /** 返回解绑函数：effect 清理时必须调用，否则流式内容会重复追加。 */
  onChunk(listener: (event: ChatChunkEvent) => void): () => void
  onDone(listener: (event: ChatDoneEvent) => void): () => void
  onError(listener: (event: ChatErrorEvent) => void): () => void
}

/** preload 暴露到 window.pointstudio 上的完整形态。 */
export interface PointStudioApi {
  electronVersion: string
  chat: ChatBridge
  conversations: ConversationBridge
}


// ---------------------------------------------------------------- 会话与消息

export const CONVERSATION_CHANNELS = {
  list: 'conversation:list',
  create: 'conversation:create',
  rename: 'conversation:rename',
  remove: 'conversation:remove',
  messages: 'conversation:messages'
} as const

/** 跨进程传输用的会话形态：只放界面需要显示的字段。 */
export interface ConversationDto {
  id: string
  title: string
  assistantId: string | null
  createdAt: string
  updatedAt: string
}

export interface MessageDto {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  status: 'complete' | 'error'
  createdAt: string
}

/**
 * 统一的结果形态。code 直接用领域错误码（E_NOT_FOUND / E_TITLE_TOO_LONG …），
 * 界面按码判断，不解析人读文案。
 */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; code: string }

export interface CreateConversationRequest {
  title?: string
}

export interface ConversationBridge {
  list(): Promise<ConversationDto[]>
  create(request?: CreateConversationRequest): Promise<IpcResult<ConversationDto>>
  rename(id: string, title: string): Promise<IpcResult<ConversationDto>>
  remove(id: string): Promise<IpcResult<true>>
  messages(id: string): Promise<MessageDto[]>
}
