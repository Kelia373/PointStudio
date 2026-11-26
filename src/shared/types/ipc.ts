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
  setModel: 'conversation:set-model',
  deleteTurn: 'conversation:delete-turn',
  exportMarkdown: 'conversation:export-markdown'
} as const

/** 跨进程传输用的会话形态：只放界面需要显示的字段。 */
/** 会话级采样参数：只有显式设置过的项才出现。 */
export interface ConversationParamsDto {
  temperature?: number
  maxTokens?: number
  topP?: number
}

/** 升档梯队中的一棒：候选模型与其预估成功率 / 成本。 */
export interface EscalationStepDto {
  model: string
  providerId?: ProviderIdDto
  pSuccess: number
  estCostUsd?: number
}

/** PandaOrchestrator 协同路由的决策结果：纯 JSON，跨进程与跨语言均可直传。 */
export interface RouteDecisionDto {
  traceId: string
  chosenModel: string
  providerId?: ProviderIdDto
  /** 如 "policy:cheapest_above_threshold" / "static:session"。 */
  decidedBy: string
  /** 预估成功率 0~1。 */
  confidence: number
  difficulty: {
    /** 1~10。 */
    level: number
    /** implementation / debugging / architecture / explanation … */
    category: string
  }
  estCostUsd?: number
  estLatencyMs?: number
  /** 当前处于升档阶梯第几棒，缺省 1。 */
  attempt?: number
  /** 发生失败自动升档时，上一棒失败的模型名。 */
  escalatedFrom?: string
  escalationLadder?: EscalationStepDto[]
}

export interface ConversationDto {
  id: string
  title: string
  assistantId: string | null
  /** 挂载的项目（工作区）；缺省或 null 表示「主聊天（未挂载项目）」。 */
  workspaceId?: string | null
  /** 会话级模型覆盖；缺省表示跟随助手 / 全局默认。 */
  model?: string | null
  /** 会话级采样参数覆盖，优先级高于助手与全局默认。 */
  params?: ConversationParamsDto
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
  /** 该轮由协同路由产生的决策；旧消息与直连模型没有这个字段。 */
  route?: RouteDecisionDto
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
  /** 创建时就绑定助手；缺省为裸聊。 */
  assistantId?: string | null
  /** 创建时就挂到某个项目；缺省为未挂载。 */
  workspaceId?: string | null
}

export interface ConversationBridge {
  list(): Promise<ConversationDto[]>
  create(request?: CreateConversationRequest): Promise<IpcResult<ConversationDto>>
  rename(id: string, title: string): Promise<IpcResult<ConversationDto>>
  remove(id: string): Promise<IpcResult<true>>
  messages(id: string): Promise<MessageDto[]>
  /** 绑定 / 解绑助手；null 表示退回裸对话。 */
  setAssistant(id: string, assistantId: string | null): Promise<IpcResult<ConversationDto>>
  /**
   * 设置会话级模型与采样参数。
   * `model: null` 表示清掉模型覆盖；`params` 不传表示不动，传空对象表示清空覆盖。
   */
  setModel(
    id: string,
    patch: { model?: string | null; params?: ConversationParamsDto }
  ): Promise<IpcResult<ConversationDto>>
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

// ---------------------------------------------------------------- MCP 服务

export const MCP_CHANNELS = {
  list: 'mcp:list',
  add: 'mcp:add',
  remove: 'mcp:remove'
} as const

export interface McpConnectionDto {
  serverName: string
  url: string
}

export interface McpBridge {
  list(): Promise<McpConnectionDto[]>
  add(request: { serverName: string; url: string }): Promise<IpcResult<{ toolNames: string[] }>>
  remove(serverName: string): Promise<IpcResult<true>>
}

// ---------------------------------------------------------------- 备份

export const BACKUP_CHANNELS = {
  exportText: 'backup:export-text',
  importFile: 'backup:import-file'
} as const

export type RestoreModeDto = 'replace' | 'merge'

export interface RestoreCountsDto {
  added: number
  skipped: number
}

export interface BackupBridge {
  /** 整库导出为 JSON 文本（界面负责保存或复制）。 */
  exportText(): Promise<IpcResult<string>>
  /** 弹文件选择框读取备份并恢复；replace 清空后写入，merge 只补新的。 */
  importFile(mode: RestoreModeDto): Promise<IpcResult<RestoreCountsDto | true>>
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

export interface AgentStepDetailDto {
  id: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped'
  tool?: string
  durationMs?: number
  code?: string
  /** 该步骤的路由决策；直连模型时缺省。 */
  route?: RouteDecisionDto
}

export type AgentEventDto =
  | { type: 'plan'; plan: PlanViewDto }
  | { type: 'step'; plan: PlanViewDto }
  | { type: 'replan'; failedStepId: string; errorCode: string }
  | {
      type: 'done'
      status: 'completed' | 'failed' | 'stopped'
      plan: PlanViewDto
      reason?: string
      /** 最后一轮的每步详情（工具、耗时、错误码）。 */
      details?: AgentStepDetailDto[]
    }
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
  readChunk: 'workspace:read-chunk',
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
  /** 按引用里的 `path#index` 取回原文片段（点击引用时用）。 */
  readChunk(chunkId: string): Promise<IpcResult<{ path: string; index: number; text: string }>>
  remove(id: string): Promise<IpcResult<true>>
}

// ---------------------------------------------------------------- 剪贴板

// 走主进程的 Electron clipboard，而不是浏览器 API：
// `navigator.clipboard.writeText` 在无用户手势 / 权限被拒时可能**永不 resolve**，
// 界面会一直停在「复制中」。主进程这条路没有这些约束。
export const CLIPBOARD_CHANNELS = {
  writeText: 'clipboard:write-text'
} as const

export interface ClipboardBridge {
  /** 返回是否写入成功；失败不抛异常，交给界面提示。 */
  writeText(text: string): Promise<boolean>
}

export interface PointStudioApi {
  electronVersion: string
  chat: ChatBridge
  conversations: ConversationBridge
  assistants: AssistantBridge
  settings: SettingsBridge
  workspace: WorkspaceBridge
  agent: AgentBridge
  backup: BackupBridge
  mcp: McpBridge
  clipboard: ClipboardBridge
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
