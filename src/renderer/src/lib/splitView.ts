// lib/splitView —— 主舞台左右分屏的状态机（纯函数）。
//
// 右窗格是「通用副画布」：既能并排看另一条会话，也能切到注册表里的功能页，
// 还可以当一张临时 Markdown 草稿纸。状态全部放在这个纯对象里，
// 组件只做渲染与转发，方便单测，也方便以后换成主进程持久化。
import type { ConversationDto } from '../../../shared/types/ipc.ts'

export type SecondaryPaneKind = 'session' | 'page' | 'markdown' | 'trace'

export interface SplitPaneState {
  enabled: boolean
  kind: SecondaryPaneKind
  /** kind === 'session' 时的会话 id。 */
  sessionId: string | null
  /** kind === 'page' 时的注册表页面 id（如 'board' | 'prompts'）。 */
  pageId: string
  /** kind === 'trace' 时聚焦的任务链 id。 */
  traceMissionId: string | null
  /** kind === 'markdown' 时的编辑器草稿内容。 */
  markdownText: string
  /** 左窗格宽度占比，钳制在 [0.25, 0.75]，默认 0.5。 */
  ratio: number
}

export const SPLIT_MIN_RATIO = 0.25
export const SPLIT_MAX_RATIO = 0.75
export const SPLIT_DEFAULT_RATIO = 0.5
export const SPLIT_DEFAULT_PAGE_ID = 'board'
export const SPLIT_STORAGE_KEY = 'pointstudio.splitView'
export const SPLIT_MARKDOWN_KEY = 'pointstudio.splitMarkdown'

export function createSplitState(): SplitPaneState {
  return {
    enabled: false,
    kind: 'session',
    sessionId: null,
    pageId: SPLIT_DEFAULT_PAGE_ID,
    traceMissionId: null,
    markdownText: '',
    ratio: SPLIT_DEFAULT_RATIO
  }
}

function isKind(value: unknown): value is SecondaryPaneKind {
  return value === 'session' || value === 'page' || value === 'markdown' || value === 'trace'
}

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) {
    return SPLIT_DEFAULT_RATIO
  }
  return Math.min(SPLIT_MAX_RATIO, Math.max(SPLIT_MIN_RATIO, ratio))
}

/** 开关分屏；显式给 enabled 时是「设为」，不给是「切换」。 */
export function toggleSplitPane(state: SplitPaneState, enabled?: boolean): SplitPaneState {
  const next = enabled ?? !state.enabled
  return next === state.enabled ? state : { ...state, enabled: next }
}

export function setSplitRatio(state: SplitPaneState, ratio: number): SplitPaneState {
  const next = clampSplitRatio(ratio)
  return next === state.ratio ? state : { ...state, ratio: next }
}

/** 切换副画布的形态或目标；内容没变就复用原对象，避免无谓重渲染。 */
export function setSecondaryTarget(
  state: SplitPaneState,
  patch: Partial<Pick<SplitPaneState, 'kind' | 'sessionId' | 'pageId' | 'traceMissionId'>>
): SplitPaneState {
  let changed = false
  if (patch.kind !== undefined && patch.kind !== state.kind) {
    changed = true
  }
  if (patch.sessionId !== undefined && patch.sessionId !== state.sessionId) {
    changed = true
  }
  if (patch.pageId !== undefined && patch.pageId !== state.pageId) {
    changed = true
  }
  if (patch.traceMissionId !== undefined && patch.traceMissionId !== state.traceMissionId) {
    changed = true
  }
  if (!changed) {
    return state
  }
  return {
    ...state,
    kind: patch.kind ?? state.kind,
    sessionId: patch.sessionId !== undefined ? patch.sessionId : state.sessionId,
    pageId: patch.pageId ?? state.pageId,
    traceMissionId:
      patch.traceMissionId !== undefined ? patch.traceMissionId : state.traceMissionId
  }
}

/**
 * 会话被删掉（或还没选）时给副画布兜一个可用会话：
 * 优先挑「不是主窗格那条」，实在没有就退回第一条，全局没有就置空。
 */
export function reconcileSplitSession(
  state: SplitPaneState,
  sessions: ConversationDto[],
  primarySessionId: string | null
): SplitPaneState {
  if (state.kind !== 'session') {
    return state
  }
  // 用户主动选的「空」保持为空：不要在下一次会话列表刷新时偷偷填一条回去
  if (state.sessionId === null) {
    return state
  }
  if (sessions.some((session) => session.id === state.sessionId)) {
    return state
  }
  const fallback =
    sessions.find((session) => session.id !== primarySessionId) ?? sessions[0] ?? null
  const nextId = fallback ? fallback.id : null
  return nextId === state.sessionId ? state : { ...state, sessionId: nextId }
}

/** 从 localStorage 的 JSON 里恢复；坏数据一律退回默认值，不让界面卡死在脏状态。 */
export function parseSplitState(raw: string | null): SplitPaneState {
  const base = createSplitState()
  if (!raw) {
    return base
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return base
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return base
  }
  const record = parsed as Record<string, unknown>
  return {
    enabled: record['enabled'] === true,
    kind: isKind(record['kind']) ? record['kind'] : base.kind,
    sessionId: typeof record['sessionId'] === 'string' ? record['sessionId'] : null,
    pageId: typeof record['pageId'] === 'string' && record['pageId'] !== '' ? record['pageId'] : base.pageId,
    traceMissionId:
      typeof record['traceMissionId'] === 'string' ? record['traceMissionId'] : null,
    markdownText: '',
    ratio: clampSplitRatio(typeof record['ratio'] === 'number' ? record['ratio'] : base.ratio)
  }
}
