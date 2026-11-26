// ipc/validators —— 进程边界的运行时校验（不依赖 electron，可直接单测）。
//
// 为什么单独成文件：这些判断原来散在五个 handler 里，各自复制同一份 UUID
// 正则与字段检查——改一处漏一处的风险很高，而且一行都测不到。
//
// 铁律：渲染进程是**不可信**的。TypeScript 类型在跨进程时不存在，
// 所以每个入参都必须真的验一遍。
import type {
  AgentRunRequest,
  ChatSendRequest,
  CreateConversationRequest,
  ProviderSettingsDraftRequest
} from '../../shared/types/ipc.ts'
import type { AssistantDraft } from '../ai/domain/assistant.ts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_TEXT_LENGTH = 8_000

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isChatSendRequest(value: unknown): value is ChatSendRequest {
  if (!isObject(value)) {
    return false
  }
  return (
    isUuid(value.id) &&
    isUuid(value.conversationId) &&
    typeof value.text === 'string' &&
    value.text.length <= MAX_TEXT_LENGTH
  )
}

export function isCreateConversationRequest(
  value: unknown
): value is CreateConversationRequest | undefined {
  if (value === undefined) {
    return true
  }
  if (!isObject(value)) {
    return false
  }
  const optionalId = (field: unknown): boolean =>
    field === undefined || field === null || typeof field === 'string'
  return (
    (value.title === undefined || typeof value.title === 'string') &&
    optionalId(value.assistantId) &&
    optionalId(value.workspaceId)
  )
}

export function isAssistantDraft(value: unknown): value is AssistantDraft {
  if (!isObject(value) || typeof value.name !== 'string') {
    return false
  }
  if (value.systemPrompt !== undefined && typeof value.systemPrompt !== 'string') {
    return false
  }
  if (value.modelId !== undefined && value.modelId !== null && typeof value.modelId !== 'string') {
    return false
  }
  if (
    value.providerId !== undefined &&
    value.providerId !== null &&
    typeof value.providerId !== 'string'
  ) {
    return false
  }
  if (value.params !== undefined && !isObject(value.params)) {
    return false
  }
  return true
}

export function isProviderSettingsDraft(
  value: unknown
): value is ProviderSettingsDraftRequest {
  if (!isObject(value)) {
    return false
  }
  if (value.apiKey !== undefined && typeof value.apiKey !== 'string') {
    return false
  }
  if (
    value.providerId !== undefined &&
    value.providerId !== 'deepseek' &&
    value.providerId !== 'ollama'
  ) {
    return false
  }
  if (value.baseUrl !== undefined && typeof value.baseUrl !== 'string') {
    return false
  }
  if (value.model !== undefined && typeof value.model !== 'string') {
    return false
  }
  if (value.params !== undefined) {
    if (!isObject(value.params)) {
      return false
    }
    for (const key of ['temperature', 'maxTokens', 'topP']) {
      const item = value.params[key]
      if (item !== undefined && typeof item !== 'number') {
        return false
      }
    }
  }
  return true
}

export function isAgentRunRequest(value: unknown): value is AgentRunRequest {
  if (!isObject(value)) {
    return false
  }
  if (!isUuid(value.id) || typeof value.goal !== 'string' || value.goal.trim() === '') {
    return false
  }
  const confirmed = value.confirmedStepIds
  if (confirmed === undefined) {
    return true
  }
  return Array.isArray(confirmed) && confirmed.every((item) => typeof item === 'string')
}

export function isWorkspaceImportPath(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** 会话级模型设置：model 允许 null / 字符串；params 只允许三个数字字段。 */
export function isConversationModelPatch(value: unknown): value is {
  model?: string | null
  params?: { temperature?: number; maxTokens?: number; topP?: number }
} {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const input = value as Record<string, unknown>

  if ('model' in input && input['model'] !== null && typeof input['model'] !== 'string') {
    return false
  }

  if ('params' in input && input['params'] !== undefined) {
    const params = input['params']
    if (typeof params !== 'object' || params === null) {
      return false
    }
    for (const key of ['temperature', 'maxTokens', 'topP']) {
      const raw = (params as Record<string, unknown>)[key]
      if (raw !== undefined && (typeof raw !== 'number' || !Number.isFinite(raw))) {
        return false
      }
    }
  }

  return true
}
