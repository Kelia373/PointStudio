// store/studioStore —— 外置响应式状态：用 React 原生 useSyncExternalStore，
// 不引入任何状态库。
//
// 关键设计：消息切成两片。
//   historyMessages —— 已完成的历史消息，流式吐字时这个引用不变，长列表 0 重绘；
//   inflightMessage —— 正在生长的那一条，只有订阅它的组件会重渲染。
// 配合 rafBatcher 的 16ms 帧合并，流式输出不再一秒重绘几十次。
import { useRef, useSyncExternalStore } from 'react'

import type {
  AssistantDto,
  ConversationDto,
  McpConnectionDto,
  ProviderSettingsViewDto,
  RouteDecisionDto
} from '../../../shared/types/ipc.ts'
import type { UiMessage } from '../lib/chatState.ts'
import type { PlanRunState } from '../lib/planRunState.ts'

export type StudioMode = 'live' | 'local'

export interface StudioState {
  conversations: ConversationDto[]
  activeId: string | null
  assistants: AssistantDto[]
  provider: ProviderSettingsViewDto | null
  mcpConnections: McpConnectionDto[]

  /** 已完成的历史消息；流式期间保持不变。 */
  historyMessages: UiMessage[]
  /** 正在流式生长的那一条；结束后并入 historyMessages 并置空。 */
  inflightMessage: UiMessage | null

  busy: boolean
  inflightId: string | null
  mode: StudioMode | null
  lastRunMs: number | null
  planRun: PlanRunState | null
  /** 当前主舞台页面：'chat' | 'settings' | 插件页面 id。 */
  activePage: string
  lastRouteDecision: RouteDecisionDto | null
}

export type Listener = () => void
export type SetState = (patch: Partial<StudioState> | ((current: StudioState) => Partial<StudioState>)) => void

export const INITIAL_STUDIO_STATE: StudioState = {
  conversations: [],
  activeId: null,
  assistants: [],
  provider: null,
  mcpConnections: [],
  historyMessages: [],
  inflightMessage: null,
  busy: false,
  inflightId: null,
  mode: null,
  lastRunMs: null,
  planRun: null,
  activePage: 'chat',
  lastRouteDecision: null
}

/** 把整条列表按「已完成 / 正在流式」切开；不在流式中时全部算历史。 */
export function splitMessages(
  messages: UiMessage[],
  inflightId: string | null
): { history: UiMessage[]; inflight: UiMessage | null } {
  if (!inflightId) {
    return { history: messages, inflight: null }
  }
  const inflight = messages.find((message) => message.id === inflightId) ?? null
  if (!inflight) {
    return { history: messages, inflight: null }
  }
  return { history: messages.filter((message) => message.id !== inflightId), inflight }
}

export interface StudioStore {
  getState(): StudioState
  getVersion(): number
  subscribe(listener: Listener): () => void
  setState: SetState
  replaceMessages(messages: UiMessage[], inflightId: string | null): void
}

export function createStudioStore(initial: Partial<StudioState> = {}): StudioStore {
  let state: StudioState = { ...INITIAL_STUDIO_STATE, ...initial }
  let version = 0
  const listeners = new Set<Listener>()

  const store: StudioStore = {
    getState: () => state,
    getVersion: () => version,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    setState(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...next }
      version += 1
      for (const listener of listeners) {
        listener()
      }
    },
    replaceMessages(messages, inflightId) {
      const split = splitMessages(messages, inflightId)
      store.setState({ historyMessages: split.history, inflightMessage: split.inflight })
    }
  }

  return store
}

export const studioStore = createStudioStore()

/**
 * 细粒度订阅：只在本切片真的变化时才返回新引用。
 * selector 必须是纯函数；isEqual 用于数组等结构比较。
 */
export function useStudioSlice<T>(
  selector: (state: StudioState) => T,
  isEqual: (a: T, b: T) => boolean = Object.is
): T {
  const version = useSyncExternalStore(
    studioStore.subscribe,
    studioStore.getVersion,
    studioStore.getVersion
  )
  const cache = useRef<{ version: number; value: T } | null>(null)
  const value = selector(studioStore.getState())

  if (!cache.current || cache.current.version !== version || !isEqual(cache.current.value, value)) {
    cache.current = { version, value }
  }
  return cache.current.value
}
