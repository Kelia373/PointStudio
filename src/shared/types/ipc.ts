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
  cancel: 'chat:cancel',
  usage: 'chat:usage'
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
  /** 群聊里被 @ 的成员：本轮由该 Agent 接管回答；缺省用会话绑定的 Agent。 */
  assistantId?: string | null
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
  /** 缺省为 'content'（正文）；'reasoning' 表示模型的思考增量。 */
  kind?: 'content' | 'reasoning'
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

/** 一轮真实 token 用量（来自平台 usage 尾帧）。 */
export interface ChatUsageEvent {
  id: string
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  totalTokens: number
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
  onUsage(listener: (event: ChatUsageEvent) => void): () => void
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
  exportMarkdown: 'conversation:export-markdown',
  /** 裁剪：删除指定消息及其后续（用于编辑重发）。 */
  truncateFrom: 'conversation:truncate-from',
  /** 分叉：复制截至某条消息的上下文到新会话。 */
  branch: 'conversation:branch'
} as const

/** 跨进程传输用的会话形态：只放界面需要显示的字段。 */
/** 会话级采样参数：只有显式设置过的项才出现。 */
export interface ConversationParamsDto {
  temperature?: number
  maxTokens?: number
  topP?: number
  /** 思考强度；缺省 / null 表示跟随模型默认。 */
  effort?: ReasoningEffortDto | null
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
  /** 会话级服务商覆盖；缺省表示跟随助手绑定 / 全局默认。 */
  providerId?: string | null
  /** 小组聊天归属的小组 id；普通会话缺省。 */
  groupId?: string | null
  /** true 表示绑定 Agent 的常驻主聊天（Home Chat）；缺省/false 为普通或专题会话。 */
  isHome?: boolean
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
  /** 归属的任务链；没有就是普通对话。 */
  missionId?: string | null
  /** 交接 / 派单 / 收据卡；有值时主群只渲染一行瘦胶囊。 */
  handoff?: HandoffEnvelopeDto | null
  /** 模型深度思考内容；普通无推理回复缺省。 */
  reasoning?: string
  /** 思考阶段耗时（毫秒）；缺省则不显示秒数。 */
  reasoningMs?: number
}

/**
 * 任务链上的一个交接信封（纯 JSON，跨 IPC 只传这些字段）。
 * 主群只显示 summary；payloadMarkdown 默认折叠，点「右屏盯盘」再展开。
 */
export interface HandoffEnvelopeDto {
  handoffId: string
  missionId: string
  fromAgentId: string | 'owner'
  toAgentId: string
  kind: 'handoff' | 'question' | 'subagent_spawn' | 'receipt'
  /** 一句话摘要（≤60 字），主群胶囊只显示它。 */
  summary: string
  /** 完整施工单 / 对账正文；不在主群展开。 */
  payloadMarkdown: string
  status: 'pending' | 'accepted' | 'running' | 'done' | 'failed'
  targetRunId?: string
}

/**
 * 一个 Agent 小组（纯 UI 数据，渲染层 localStorage 持久化）。
 * 不放进 AssistantDto：一个 Agent 将来可以跨组兼职，单值 groupId 会作废。
 */
export interface AgentGroupDto {
  id: string
  name: string
  /** 组内成员 agentId，有序、去重。 */
  memberIds: string[]
  /** 组长；缺省取 memberIds[0] ?? null。 */
  leadAgentId: string | null
  collapsed?: boolean
  updatedAt: string
}

/**
 * 一个 Agent 分身（主身或 Subagent）手上的一个 Run。
 * 同一 Agent 可以有多条并行，侧栏据此显示并发徽章与子泳道。
 */
export interface AgentWorkerRunDto {
  runId: string
  /** 归属的主智能体 ID。 */
  agentId: string
  /** 子智能体角色名；主身填 null。 */
  subagentRole: string | null
  /** 串联「派单 → 架构 → 开发 → 测试」的根任务链。 */
  missionId: string
  /** 派单方：'owner' 或来源 agentId。 */
  dispatchedBy: string
  /** 一句话任务摘要。 */
  taskTitle: string
  sessionId: string
  status: 'working' | 'waiting' | 'error' | 'completed' | 'queued'
  progress?: { current: number; total: number; stepLabel: string }
  startedAt: string
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
  /** 小组聊天：绑定到侧栏的小组 id。 */
  groupId?: string | null
  /** 创建 Agent 的常驻主聊天；必须同时给 assistantId，且不能是小组会话。 */
  isHome?: boolean
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
    patch: { model?: string | null; providerId?: string | null; params?: ConversationParamsDto }
  ): Promise<IpcResult<ConversationDto>>
  /** 删除「这一轮」：用户消息连同其后的助手回复。 */
  deleteTurn(conversationId: string, messageId: string): Promise<IpcResult<{ removed: number }>>
  /** 导出为 Markdown 文本（界面负责写文件或复制）。 */
  exportMarkdown(conversationId: string): Promise<IpcResult<string>>
  /** 删除 fromMessageId 及其后的所有消息。 */
  truncateFrom(
    conversationId: string,
    fromMessageId: string
  ): Promise<IpcResult<{ removed: number }>>
  /** 复制截至 upToMessageId（含）的消息到新会话。 */
  branch(request: BranchConversationRequest): Promise<IpcResult<ConversationDto>>
}

export interface BranchConversationRequest {
  conversationId: string
  upToMessageId: string
  title?: string
}


// ---------------------------------------------------------------- 助手

export const ASSISTANT_CHANNELS = {
  list: 'assistant:list',
  create: 'assistant:create',
  update: 'assistant:update',
  remove: 'assistant:remove'
} as const

/** Agent 权限模式：五档，默认 smart。 */
export type AgentPermissionMode = 'ask' | 'plan-only' | 'auto-edit' | 'smart' | 'full-access'

export const AGENT_PERMISSION_MODES: readonly AgentPermissionMode[] = [
  'ask',
  'plan-only',
  'auto-edit',
  'smart',
  'full-access'
]

/**
 * 内置「通用助手」的固定 id。
 *
 * 为什么写死而不是随机生成：它是每条老自由对话的收编落点，也是启动迁移的
 * 幂等锚点——每次启动都按这个 id 找，找到了就不再新建。取值是合法的 v4 格式，
 * 所以全仓的 `isUuid()` 校验一行都不用放宽。
 */
export const DEFAULT_ASSISTANT_ID = '00000000-0000-4000-8000-000000000001'

export interface AssistantDto {
  id: string
  name: string
  systemPrompt: string
  providerId: string | null
  modelId: string | null
  params: { temperature: number; maxTokens: number; topP: number; effort?: ReasoningEffortDto | null }
  /** 停用后不再出现在派发候选里。老数据没有这个字段时视为启用。 */
  enabled?: boolean
  /** 五档权限模式；老数据缺省按 smart。 */
  permissionMode?: AgentPermissionMode
  /** 手选的 3D 头像 key；null / 缺省表示按名称自动匹配。 */
  avatar?: string | null
  /** true 表示系统内置的常驻「通用助手」：不可删除、不可停用。 */
  builtin?: boolean
  createdAt: string
  updatedAt: string
}

export interface AssistantDraftRequest {  name: string
  /** 省略表示「不动」：新建按启用处理，更新时保留原状态。 */
  enabled?: boolean
  systemPrompt?: string
  modelId?: string | null
  providerId?: string | null
  params?: {
    temperature?: number
    maxTokens?: number
    topP?: number
    effort?: ReasoningEffortDto | null
  }
  permissionMode?: AgentPermissionMode
  avatar?: string | null
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
  /** 当前 Agent 的权限模式；缺省 smart，主进程据此决定哪些步骤要确认。 */
  permissionMode?: AgentPermissionMode
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
  providers: ProvidersBridge
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

// ---------------------------------------------------------------- 多服务商凭据 / 模型 / 用量

export const PROVIDERS_CHANNELS = {
  listAccounts: 'providers:list-accounts',
  saveAccount: 'providers:save-account',
  clearAccount: 'providers:clear-account',
  fetchModels: 'providers:fetch-models',
  fetchUsage: 'providers:fetch-usage',
  readLedger: 'providers:read-ledger'
} as const

/** 发请求时走的线路协议。 */
export type ProviderWireProtocolDto =
  | 'openai-compatible'
  | 'deepseek'
  | 'opencode-go'
  | 'anthropic'
  | 'gemini'
  | 'ollama'

/** 跨进程脱敏账户视图：明文 apiKey 永不出主进程。 */
export interface ProviderAccountViewDto {
  providerId: string
  protocol: ProviderWireProtocolDto
  hasKey: boolean
  maskedKey: string
  baseUrl: string
  defaultModel: string
  params?: ProviderParamsDto
  updatedAt: string | null
}

export interface SaveProviderAccountRequest {
  providerId: string
  protocol?: ProviderWireProtocolDto
  /** 留空或省略表示保留已保存的 Key（改地址 / 模型不丢 Key）。 */
  apiKey?: string
  baseUrl: string
  defaultModel?: string
  params?: ProviderParamsDto
}

/** 思考强度：界面顺序是 默认 · Low · Med · High · XHigh · Max。 */
export type ReasoningEffortDto = 'low' | 'mid' | 'high' | 'xhigh' | 'max'

/** 强度如何落到上游协议：没有 / reasoning_effort / thinking budget / 固定开启。 */
export type EffortWireModeDto = 'none' | 'reasoning_effort' | 'thinking_budget' | 'fixed'

export interface ModelCapabilitiesDto {
  /** 是否支持 Function Calling / MCP 工具。 */
  supportsTools: boolean
  /** 真实支持的档位子集；空数组表示不可调档。 */
  supportedEfforts: ReasoningEffortDto[]
  /** fixed 表示固定开启思考但不可调档（如 deepseek-reasoner）。 */
  effortMode: EffortWireModeDto
}

export interface DiscoveredModelDto {
  id: string
  /** OpenCode Go 等平台可能分线路由。 */
  wire?: 'openai' | 'anthropic' | 'google'
  /** `-free` 模型仅官方客户端可用，标记为不可直选。 */
  selectable: boolean
  note?: string
  /** 真实能力画像；拉取时推断，界面据此只亮可用档位。 */
  capabilities?: ModelCapabilitiesDto
}

export interface FetchModelsResultDto {
  providerId: string
  models: DiscoveredModelDto[]
  latencyMs: number
  fetchedAt: string
}

export interface QuotaWindowDto {
  window: 'rolling' | 'weekly' | 'monthly'
  percent: number
  resetsAt: string | null
  status?: string
}

export interface BalanceInfoDto {
  currency: string
  totalBalance: string
  grantedBalance?: string
  toppedUpBalance?: string
}

export interface ProviderUsageDto {
  providerId: string
  kind: 'balance' | 'quota-windows' | 'unsupported'
  available?: boolean
  balances?: BalanceInfoDto[]
  windows?: QuotaWindowDto[]
  fetchedAt: string
  note?: string
}

export type UsageRangeDto = 'today' | '7d' | '30d' | 'all'

export interface UsageBucketDto {
  key: string
  calls: number
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  totalTokens: number
}

export interface UsageLedgerSummaryDto {
  range: UsageRangeDto
  totalCalls: number
  totalPromptTokens: number
  totalCompletionTokens: number
  totalCacheHitTokens: number
  totalTokens: number
  byProvider: UsageBucketDto[]
  byAssistant: UsageBucketDto[]
}

export interface ProvidersBridge {
  listAccounts(): Promise<ProviderAccountViewDto[]>
  saveAccount(request: SaveProviderAccountRequest): Promise<IpcResult<ProviderAccountViewDto>>
  clearAccount(providerId: string): Promise<IpcResult<true>>
  fetchModels(providerId: string): Promise<IpcResult<FetchModelsResultDto>>
  fetchUsage(providerId: string): Promise<IpcResult<ProviderUsageDto>>
  readLedger(range: UsageRangeDto): Promise<UsageLedgerSummaryDto>
}
