// lib/agentClipboard —— 复制 / 粘贴 Agent 的载荷。
//
// 「复制」只把配置放进应用内剪贴板（localStorage），「粘贴」才真正创建。
// 放在这里而不是组件里，是因为三件事都会被测：roundtrip、坏数据、重名规则。
//
// 注意：Agent 目前没有头像字段，能复制的只有名称 / 提示词 / 模型 / 参数。

export interface AgentClipParams {
  temperature: number
  maxTokens: number
  topP: number
}

export interface AgentClipPayload {
  name: string
  systemPrompt: string
  providerId: string | null
  modelId: string | null
  params: AgentClipParams
}

export const AGENT_CLIPBOARD_KEY = 'pointstudio.agentClipboard.v1'

const DEFAULT_PARAMS: AgentClipParams = { temperature: 0.7, maxTokens: 2048, topP: 1 }

/** 复制时只留这五个字段：id / 时间戳属于原实体，不能跟着走。 */
export function serializeAgentClip(agent: AgentClipPayload): string {
  const payload: AgentClipPayload = {
    name: agent.name.trim(),
    systemPrompt: agent.systemPrompt ?? '',
    providerId: agent.providerId ?? null,
    modelId: agent.modelId ?? null,
    params: { ...DEFAULT_PARAMS, ...(agent.params ?? {}) }
  }
  return JSON.stringify(payload)
}

/** 解析剪贴板；任何一处不像样就返回 null，绝不粘出半个 Agent。 */
export function parseAgentClip(raw: string | null): AgentClipPayload | null {
  if (!raw) {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null
  }

  const value = parsed as Record<string, unknown>
  const name = typeof value.name === 'string' ? value.name.trim() : ''
  if (name === '') {
    return null
  }

  const rawParams =
    typeof value.params === 'object' && value.params !== null
      ? (value.params as Record<string, unknown>)
      : {}
  const numberOr = (key: string, fallback: number): number => {
    const candidate = rawParams[key]
    return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallback
  }

  return {
    name,
    systemPrompt: typeof value.systemPrompt === 'string' ? value.systemPrompt : '',
    providerId: typeof value.providerId === 'string' ? value.providerId : null,
    modelId: typeof value.modelId === 'string' ? value.modelId : null,
    params: {
      temperature: numberOr('temperature', DEFAULT_PARAMS.temperature),
      maxTokens: numberOr('maxTokens', DEFAULT_PARAMS.maxTokens),
      topP: numberOr('topP', DEFAULT_PARAMS.topP)
    }
  }
}

/** 原名字 → 粘贴出来的名字。 */
export function copyAgentName(name: string): string {
  const base = name.trim()
  return base === '' ? '副本' : `${base} 副本`
}

function normalize(name: string): string {
  return name.trim().toLowerCase()
}

/** 重名就加序号：同一批里永远不会出现两个同名 Agent。 */
export function uniqueAgentName(desired: string, taken: string[]): string {
  const existing = new Set(taken.map(normalize))
  const base = desired.trim()
  if (!existing.has(normalize(base))) {
    return base
  }
  let index = 2
  while (existing.has(normalize(`${base} ${index}`))) {
    index += 1
  }
  return `${base} ${index}`
}

/** 改名校验：忽略首尾空格与大小写；空名字交给后端报 E_NAME_REQUIRED。 */
export function isAgentNameTaken(name: string, others: string[]): boolean {
  const target = normalize(name)
  if (target === '') {
    return false
  }
  return others.some((other) => normalize(other) === target)
}
