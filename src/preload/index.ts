import { contextBridge, ipcRenderer } from 'electron'

// 预加载层是 renderer 与 main 之间唯一的桥。
// 所有 IPC 能力都必须从这里白名单式导出，不允许在 renderer 里直接 import electron。
//
// 每个订阅方法都返回「解绑函数」：React 的 effect 清理阶段必须调用，
// 否则每渲染一次就多挂一个监听，流式内容会被重复追加。

import {
  ASSISTANT_CHANNELS,
  CHAT_CHANNELS,
  CONVERSATION_CHANNELS,
  type AssistantBridge,
  type AssistantDto,
  type AssistantDraftRequest,
  type ChatBridge,
  type ChatChunkEvent,
  type ChatDoneEvent,
  type ChatErrorEvent,
  type ChatNoticeEvent,
  type ChatSendRequest,
  type ChatSendResult,
  type ConversationBridge,
  type ConversationDto,
  type CreateConversationRequest,
  type IpcResult,
  type MessageDto,
  type PointStudioApi,
  SETTINGS_CHANNELS,
  WORKSPACE_CHANNELS,
  AGENT_CHANNELS,
  BACKUP_CHANNELS,
  MCP_CHANNELS,
  type McpBridge,
  type McpConnectionDto,
  type BackupBridge,
  type RestoreCountsDto,
  type RestoreModeDto,
  type AgentBridge,
  type AgentEventDto,
  type AgentRunRequest,
  type WorkspaceBridge,
  type WorkspaceFileDto,
  type ProviderSettingsDraftRequest,
  type ProviderSettingsViewDto,
  type SettingsBridge,
  CLIPBOARD_CHANNELS,
  type ClipboardBridge
} from '../shared/types/ipc.ts'

type Unsubscribe = () => void

function subscribe<TPayload>(
  channel: string,
  listener: (payload: TPayload) => void
): Unsubscribe {
  // 包一层：渲染进程只能拿到 payload，拿不到 IpcRendererEvent（里面有权能信息）。
  const handler = (_event: unknown, payload: TPayload): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

const chat: ChatBridge = {
  send: (request: ChatSendRequest): Promise<ChatSendResult> =>
    ipcRenderer.invoke(CHAT_CHANNELS.send, request) as Promise<ChatSendResult>,
  cancel: (id: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(CHAT_CHANNELS.cancel, id) as Promise<IpcResult<true>>,
  onChunk: (listener: (event: ChatChunkEvent) => void): Unsubscribe =>
    subscribe(CHAT_CHANNELS.chunk, listener),
  onDone: (listener: (event: ChatDoneEvent) => void): Unsubscribe =>
    subscribe(CHAT_CHANNELS.done, listener),
  onError: (listener: (event: ChatErrorEvent) => void): Unsubscribe =>
    subscribe(CHAT_CHANNELS.error, listener),
  onNotice: (listener: (event: ChatNoticeEvent) => void): Unsubscribe =>
    subscribe(CHAT_CHANNELS.notice, listener)
}

const conversations: ConversationBridge = {
  list: (): Promise<ConversationDto[]> =>
    ipcRenderer.invoke(CONVERSATION_CHANNELS.list) as Promise<ConversationDto[]>,
  create: (request?: CreateConversationRequest): Promise<IpcResult<ConversationDto>> =>
    ipcRenderer.invoke(CONVERSATION_CHANNELS.create, request) as Promise<IpcResult<ConversationDto>>,
  rename: (id: string, title: string): Promise<IpcResult<ConversationDto>> =>
    ipcRenderer.invoke(CONVERSATION_CHANNELS.rename, id, title) as Promise<IpcResult<ConversationDto>>,
  remove: (id: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(CONVERSATION_CHANNELS.remove, id) as Promise<IpcResult<true>>,
  messages: (id: string): Promise<MessageDto[]> =>
    ipcRenderer.invoke(CONVERSATION_CHANNELS.messages, id) as Promise<MessageDto[]>,
  setAssistant: (id: string, assistantId: string | null): Promise<IpcResult<ConversationDto>> =>
    ipcRenderer.invoke(
      CONVERSATION_CHANNELS.setAssistant,
      id,
      assistantId
    ) as Promise<IpcResult<ConversationDto>>,
  deleteTurn: (
    conversationId: string,
    messageId: string
  ): Promise<IpcResult<{ removed: number }>> =>
    ipcRenderer.invoke(CONVERSATION_CHANNELS.deleteTurn, conversationId, messageId) as Promise<
      IpcResult<{ removed: number }>
    >,
  exportMarkdown: (conversationId: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(CONVERSATION_CHANNELS.exportMarkdown, conversationId) as Promise<
      IpcResult<string>
    >
}

const assistants: AssistantBridge = {
  list: (): Promise<AssistantDto[]> =>
    ipcRenderer.invoke(ASSISTANT_CHANNELS.list) as Promise<AssistantDto[]>,
  create: (request: AssistantDraftRequest): Promise<IpcResult<AssistantDto>> =>
    ipcRenderer.invoke(ASSISTANT_CHANNELS.create, request) as Promise<IpcResult<AssistantDto>>,
  update: (id: string, request: AssistantDraftRequest): Promise<IpcResult<AssistantDto>> =>
    ipcRenderer.invoke(ASSISTANT_CHANNELS.update, id, request) as Promise<IpcResult<AssistantDto>>,
  remove: (id: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(ASSISTANT_CHANNELS.remove, id) as Promise<IpcResult<true>>
}

const settings: SettingsBridge = {
  readProvider: (): Promise<ProviderSettingsViewDto> =>
    ipcRenderer.invoke(SETTINGS_CHANNELS.readProvider) as Promise<ProviderSettingsViewDto>,
  saveProvider: (request: ProviderSettingsDraftRequest): Promise<IpcResult<ProviderSettingsViewDto>> =>
    ipcRenderer.invoke(SETTINGS_CHANNELS.saveProvider, request) as Promise<
      IpcResult<ProviderSettingsViewDto>
    >,
  clearProvider: (): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(SETTINGS_CHANNELS.clearProvider) as Promise<IpcResult<true>>
}

const workspace: WorkspaceBridge = {
  list: (): Promise<WorkspaceFileDto[]> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.list) as Promise<WorkspaceFileDto[]>,
  importPath: (absolutePath: string): Promise<IpcResult<WorkspaceFileDto>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.import, absolutePath) as Promise<IpcResult<WorkspaceFileDto>>,
  pickAndImport: (): Promise<IpcResult<WorkspaceFileDto>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.pickAndImport) as Promise<IpcResult<WorkspaceFileDto>>,
  remove: (id: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.remove, id) as Promise<IpcResult<true>>,
  readChunk: (
    chunkId: string
  ): Promise<IpcResult<{ path: string; index: number; text: string }>> =>
    ipcRenderer.invoke(WORKSPACE_CHANNELS.readChunk, chunkId) as Promise<
      IpcResult<{ path: string; index: number; text: string }>
    >
}

const agent: AgentBridge = {
  run: (request: AgentRunRequest): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(AGENT_CHANNELS.run, request) as Promise<IpcResult<true>>,
  onEvent: (listener: (event: AgentEventDto) => void): Unsubscribe =>
    subscribe(AGENT_CHANNELS.event, listener)
}

const backup: BackupBridge = {
  exportText: (): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(BACKUP_CHANNELS.exportText) as Promise<IpcResult<string>>,
  importFile: (mode: RestoreModeDto): Promise<IpcResult<RestoreCountsDto | true>> =>
    ipcRenderer.invoke(BACKUP_CHANNELS.importFile, mode) as Promise<
      IpcResult<RestoreCountsDto | true>
    >
}

const mcp: McpBridge = {
  list: (): Promise<McpConnectionDto[]> =>
    ipcRenderer.invoke(MCP_CHANNELS.list) as Promise<McpConnectionDto[]>,
  add: (request: { serverName: string; url: string }): Promise<IpcResult<{ toolNames: string[] }>> =>
    ipcRenderer.invoke(MCP_CHANNELS.add, request) as Promise<IpcResult<{ toolNames: string[] }>>,
  remove: (serverName: string): Promise<IpcResult<true>> =>
    ipcRenderer.invoke(MCP_CHANNELS.remove, serverName) as Promise<IpcResult<true>>
}

const clipboardBridge: ClipboardBridge = {
  // 主进程写入可能失败（非字符串 / 超长），失败只回 false，不抛给界面。
  writeText: (text: string): Promise<boolean> =>
    ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, text) as Promise<boolean>
}

const api: PointStudioApi = {
  electronVersion: process.versions.electron,
  chat,
  conversations,
  assistants,
  settings,
  workspace,
  agent,
  backup,
  mcp,
  clipboard: clipboardBridge
}

contextBridge.exposeInMainWorld('pointstudio', api)
