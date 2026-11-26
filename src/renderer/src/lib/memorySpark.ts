// lib/memorySpark —— 私域记忆：从对话里提炼候选、按作用域唤醒。
//
// 纯函数为主，存储通过注入的 storage 访问，便于将来搬主进程 / Rust。
// 结构保持纯 JSON，键名 pointstudio.agentMemories.v1 是迁移契约。

export type MemoryScope = 'global' | `project:${string}`

export interface AgentMemoryItem {
  id: string
  agentId: string
  scope: MemoryScope
  text: string
  sourceSessionId: string
  locked: boolean
  createdAt: string
}

export const MEMORY_STORAGE_KEY = 'pointstudio.agentMemories.v1'
/** 摘要上限：超过就失去"一眼扫完"的价值。 */
const MAX_SUMMARY = 80
/** 唤醒条最多展示条数。 */
const MAX_ACTIVE = 3

const RULE_SIGNALS = ['以后', '记住', '不要', '一律', '约定', '规范', '记得', '下次']
const PROJECT_SIGNAL = /(本项目|这个项目|该项目|本工程)/

function collapse(text: string): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

function trimTo(text: string, max: number): string {
  const chars = Array.from(text)
  return chars.length > max ? chars.slice(0, max).join('') : text
}

export interface MemoryCandidate {
  suggestedText: string
  defaultScope: 'global' | 'project'
}

/**
 * 判断这一轮对话值不值得沉淀成记忆。
 * 优先看用户说了规则；没有则看助手是否给出了明确结论。
 */
export function detectMemoryCandidate(
  userText: string,
  assistantText: string
): MemoryCandidate | null {
  const user = collapse(userText)
  const assistant = collapse(assistantText)

  let source = ''
  if (RULE_SIGNALS.some((signal) => user.includes(signal))) {
    source = user
  } else if (/^(综上|结论|总结)[：:，,]?/.test(assistant)) {
    source = assistant
  }

  if (source === '') {
    return null
  }

  return {
    suggestedText: trimTo(source, MAX_SUMMARY),
    defaultScope: PROJECT_SIGNAL.test(user) ? 'project' : 'global'
  }
}

/**
 * 当前生效的记忆：只认绑定 Agent，且作用域为全局或当前项目。
 * 没有 Agent 就没有"私域"，一律不唤醒。
 */
export function matchActiveMemories(
  memories: AgentMemoryItem[],
  agentId: string | null,
  workspaceId: string | null,
  _draft: string
): AgentMemoryItem[] {
  if (!agentId) {
    return []
  }
  const projectScope: MemoryScope = `project:${workspaceId ?? ''}`

  return memories
    .filter(
      (memory) =>
        memory.agentId === agentId && (memory.scope === 'global' || memory.scope === projectScope)
    )
    .slice(0, MAX_ACTIVE)
}

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function loadMemories(storage: StorageLike | null = defaultStorage()): AgentMemoryItem[] {
  if (!storage) {
    return []
  }
  try {
    const raw = storage.getItem(MEMORY_STORAGE_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is AgentMemoryItem => {
      const row = item as Partial<AgentMemoryItem>
      return typeof row.id === 'string' && typeof row.text === 'string' && typeof row.agentId === 'string'
    })
  } catch {
    return []
  }
}

export function saveMemories(
  items: AgentMemoryItem[],
  storage: StorageLike | null = defaultStorage()
): void {
  if (!storage) {
    return
  }
  storage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(items))
}

export function createMemory(input: {
  agentId: string
  text: string
  scope: 'global' | 'project'
  workspaceId: string | null
  sourceSessionId: string
}): AgentMemoryItem {
  return {
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    agentId: input.agentId,
    scope: input.scope === 'project' ? `project:${input.workspaceId ?? ''}` : 'global',
    text: trimTo(collapse(input.text), MAX_SUMMARY),
    sourceSessionId: input.sourceSessionId,
    locked: false,
    createdAt: new Date().toISOString()
  }
}
