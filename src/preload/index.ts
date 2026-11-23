import { contextBridge, ipcRenderer } from 'electron'

// 预加载层是 renderer 与 main 之间唯一的桥。
// 所有 IPC 能力都必须从这里白名单式导出，不允许在 renderer 里直接 import electron。
//
// 每个订阅方法都返回「解绑函数」：React 的 effect 清理阶段必须调用，
// 否则每渲染一次就多挂一个监听，流式内容会被重复追加。

import {
  CHAT_CHANNELS,
  type ChatBridge,
  type ChatChunkEvent,
  type ChatDoneEvent,
  type ChatErrorEvent,
  type ChatSendRequest,
  type ChatSendResult,
  type PointStudioApi
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
  onChunk: (listener: (event: ChatChunkEvent) => void): Unsubscribe =>
    subscribe(CHAT_CHANNELS.chunk, listener),
  onDone: (listener: (event: ChatDoneEvent) => void): Unsubscribe =>
    subscribe(CHAT_CHANNELS.done, listener),
  onError: (listener: (event: ChatErrorEvent) => void): Unsubscribe =>
    subscribe(CHAT_CHANNELS.error, listener)
}

const api: PointStudioApi = {
  electronVersion: process.versions.electron,
  chat
}

contextBridge.exposeInMainWorld('pointstudio', api)
