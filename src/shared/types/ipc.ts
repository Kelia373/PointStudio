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
  error: 'chat:error',
  notice: 'chat:notice',
  cancel: 'chat:cancel'
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

/** 上下文被裁剪的提示：告诉用户「前面几条没带上」，而不是静默丢掉。 */
export interface ChatNoticeEvent {
  id: string
  droppedCount: number
}

/** 流中途失败。 */
export interface ChatErrorEvent {
  id: string
  code: ChatErrorCode
}

/** preload 暴露给渲染进程的 chat 能力。 */
export interface ChatBridge {
  send(request: ChatSendRequest): Promise<ChatSendResult>
  /** 停止某次生成；返回是否命中在途请求。 */
  cancel(id: string): Promise<IpcResult<true>>
  /** 返回解绑函数：effect 清理时必须调用，否则流式内容会重复追加。 */
  onChunk(listener: (event: ChatChunkEvent) => void): () => void
  onDone(listener: (event: ChatDoneEvent) => void): () => void
  onError(listener: (event: ChatErrorEvent) => void): () => void
  onNotice(listener: (event: ChatNoticeEvent) => void): () => void
}

/** preload 暴露到 window.pointstudio 上的完整形态。 */

// ---------------------------------------------------------------- 会话与消息

export const CONVERSATION_CHANNELS = {
  list: 'conversation:list',
  create: 'conversation:create',
  rename: 'conversation:rename',
  remove: 'conversation:remove',
  messages: 'conversation:messages',
  setAssistant: 'conversation:set-assistant',
  deleteTurn: 'conversation:delete-turn',
  exportMarkdown: 'conversation:export-markdown'
} as const

/** 跨进程传输用的会话形态：只放界面需要显示的字段。 */
export interface ConversationDto {
  id: string
  title: string
  assistantId: string | null
  createdAt: string
  updatedAt: string
}

export interface MessageReferenceDto {
  chunkId: string
  source: string
}

export interface MessageDto {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  status: 'complete' | 'error'
  /** 回答引用的检索片段；旧消息没有这个字段。 */
  references?: MessageReferenceDto[]
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
  /** 绑定 / 解绑助手；null 表示退回裸对话。 */
  setAssistant(id: string, assistantId: string | null): Promise<IpcResult<ConversationDto>>
  /** 删除「这一轮」：用户消息连同其后的助手回复。 */
  deleteTurn(conversationId: string, messageId: string): Promise<IpcResult<{ removed: number }>>
  /** 导出为 Markdown 文本（界面负责写文件或复制）。 */
  exportMarkdown(conversationId: string): Promise<IpcResult<string>>
}


// ---------------------------------------------------------------- 助手

export const ASSISTANT_CHANNELS = {
  list: 'assistant:list',
  create: 'assistant:create',
  update: 'assistant:update',
  remove: 'assistant:remove'
} as const

export interface AssistantDto {
  id: string
  name: string
  systemPrompt: string
  providerId: string | null
  modelId: string | null
  params: { temperature: number; maxTokens: number; topP: number }
  createdAt: string
  updatedAt: string
}

export interface AssistantDraftRequest {
  name: string
  systemPrompt?: string
  modelId?: string | null
  providerId?: string | null
  params?: { temperature?: number; maxTokens?: number; topP?: number }
}

export interface AssistantBridge {
  list(): Promise<AssistantDto[]>
  create(request: AssistantDraftRequest): Promise<IpcResult<AssistantDto>>
  update(id: string, request: AssistantDraftRequest): Promise<IpcResult<AssistantDto>>
  remove(id: string): Promise<IpcResult<true>>
}

// ---------------------------------------------------------------- 计划 / 过程

export const AGENT_CHANNELS = {
  run: 'agent:run',
  event: 'agent:event'
} as const

export interface PlanStepViewDto {
  id: string
  action: string
  tool: string | null
  expect: string
  risk: 'low' | 'mid' | 'high'
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  requiresConfirmation: boolean
}

export interface PlanViewDto {
  goal: string
  assumptions: string[]
  stopConditions: string[]
  steps: PlanStepViewDto[]
  progress: {
    total: number
    pending: number
    running: number
    success: number
    failed: number
    skipped: number
  }
}

export type AgentEventDto =
  | { type: 'plan'; plan: PlanViewDto }
  | { type: 'step'; plan: PlanViewDto }
  | { type: 'replan'; failedStepId: string; errorCode: string }
  | { type: 'done'; status: 'completed' | 'failed' | 'stopped'; plan: PlanViewDto; reason?: string }
  | { type: 'error'; code: string }

export interface AgentRunRequest {
  id: string
  goal: string
  /** 用户已确认的高风险步骤 id；不传则遇到高风险步骤会停下。 */
  confirmedStepIds?: string[]
}

export interface AgentBridge {
  run(request: AgentRunRequest): Promise<IpcResult<true>>
  onEvent(listener: (event: AgentEventDto) => void): () => void
}

// ---------------------------------------------------------------- 工作区

export const WORKSPACE_CHANNELS = {
  list: 'workspace:list',
  import: 'workspace:import',
  pickAndImport: 'workspace:pick-and-import',
  remove: 'workspace:remove'
} as const

export interface WorkspaceFileDto {
  id: string
  path: string
  sizeBytes: number
  importedAt: string
}

export interface WorkspaceBridge {
  list(): Promise<WorkspaceFileDto[]>
  /** 传入从系统拿到的绝对路径；落盘与登记都在主进程完成。 */
  importPath(absolutePath: string): Promise<IpcResult<WorkspaceFileDto>>
  /** 弹系统文件选择框并导入；用户取消返回 E_CANCELLED。 */
  pickAndImport(): Promise<IpcResult<WorkspaceFileDto>>
  remove(id: string): Promise<IpcResult<true>>
}

export interface PointStudioApi {
  electronVersion: string
  chat: ChatBridge
  conversations: ConversationBridge
  assistants: AssistantBridge
  settings: SettingsBridge
  workspace: WorkspaceBridge
  agent: AgentBridge
}


// ---------------------------------------------------------------- 设置

export const SETTINGS_CHANNELS = {
  readProvider: 'settings:read-provider',
  saveProvider: 'settings:save-provider',
  clearProvider: 'settings:clear-provider'
} as const

/** 跨进程视图：只有脱敏 Key，明文永不出主进程。 */
export type ProviderIdDto = 'deepseek' | 'ollama'

export interface ProviderParamsDto {
  temperature?: number
  maxTokens?: number
  topP?: number
}

export interface ProviderSettingsViewDto {
  providerId: ProviderIdDto
  params: ProviderParamsDto
  hasKey: boolean
  maskedKey: string
  baseUrl: string
  model: string
  updatedAt: string | null
}

export interface ProviderSettingsDraftRequest {
  providerId?: ProviderIdDto
  params?: ProviderParamsDto
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface SettingsBridge {
  readProvider(): Promise<ProviderSettingsViewDto>
  saveProvider(request: ProviderSettingsDraftRequest): Promise<IpcResult<ProviderSettingsViewDto>>
  clearProvider(): Promise<IpcResult<true>>
}
