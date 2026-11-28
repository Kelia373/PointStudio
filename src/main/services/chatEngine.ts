// services/chatEngine —— 决定「这次回复走真模型还是本地假流式」。
//
// 放在 services 而不是 ipc：这是业务选择（有凭据就真的调模型，没有就降级），
// 不是协议细节。ipc 层只负责把它接到通道上。
import type { ChatProvider, ChatStreamParams, TokenUsageSample } from '../ai/providers/types.ts'
import type { ProviderParams } from '../ai/domain/providerSettings.ts'
import type { ContextMessage } from '../ai/domain/context.ts'
import type { ChatMode } from '../../shared/types/ipc.ts'
import { capabilitiesForSend } from '../ai/providers/modelCapabilities.ts'
import { buildReplyChunks } from './chatReply.ts'

/** 按 providerId 解析出的运行时账户（含明文 Key，只在主进程里流转）。 */
export interface ResolvedRuntimeAccount {
  provider: ChatProvider
  providerId: string
  apiKey: string | null
  baseUrl: string
  model: string
  params?: ProviderParams
}

export interface ChatEngineDeps {
  provider: ChatProvider
  /** 平台默认采样参数；单次调用可用 ReplyOptions.params 覆盖。 */
  params?: ProviderParams
  /** null / 空串表示没有可用凭据，走本地假回复。 */
  apiKey: string | null
  baseUrl: string
  model: string
  /**
   * 多服务商路由：按 providerId 取账户。返回 null 时回退到上面的静态依赖，
   * 因此既有测试与旧调用（不注入）行为完全不变。
   */
  resolveAccount?: (providerId?: string | null) => Promise<ResolvedRuntimeAccount | null>
}

/** 单次调用可覆盖的部分：来自助手绑定，缺省则用引擎默认值。 */
export interface ReplyOptions {
  systemPrompt?: string
  model?: string
  /** 助手 / 会话绑定的服务商；缺省走引擎默认。 */
  providerId?: string | null
  /** 会话 id：OpenCode Go 用它做 `x-opencode-session`。 */
  sessionId?: string
  params?: ChatStreamParams
  /** 已裁剪过的历史消息（不含本轮输入）。 */
  history?: ContextMessage[]
  /** 检索到的参考片段（已格式化）。非空时拼在本轮输入前面，并保留来源标注。 */
  references?: string
  /** 中断信号：用户点「停止」时由外壳触发。 */
  signal?: AbortSignal
  /** 本轮实际接管的 Agent（群聊 @ 覆盖或会话绑定）；只用于记账。 */
  resolvedAssistantId?: string | null
  /** 模型思考增量。 */
  onReasoning?: (delta: string) => void
  /** 平台回传真实 token 用量时回调（用于本地账本）。 */
  onUsage?: (sample: { providerId: string; model: string; usage: TokenUsageSample }) => void
}

/**
 * 本次会走哪条路。纯函数，界面靠它显示状态，不靠猜。
 *
 * 判断依据有两条：平台是否要求凭据、以及有没有凭据。
 * 本地模型（requiresApiKey === false）即使没 Key 也走真模型。
 */
export function resolveMode(deps: ChatEngineDeps): ChatMode {
  return resolveModeFor(deps.provider, deps.apiKey)
}

/** 单条通道的模式判断：本地模型免 Key，其余看 Key 是否为空。 */
export function resolveModeFor(provider: ChatProvider, apiKey: string | null): ChatMode {
  if (provider.requiresApiKey === false) {
    return 'live'
  }
  return (apiKey?.trim() ?? '') === '' ? 'local' : 'live'
}

/**
 * 产出回复的增量文本。
 *
 * 降级策略：无 Key 不报错，直接用本地假回复——这样任何人 clone 下来都能跑通全链路，
 * 而配了 Key 的人拿到的是真模型输出。
 *
 * 助手的 systemPrompt / 绑定模型通过 `options` 传入；引擎不认识「助手」这个概念，
 * 只认识「这次对话带不带系统提示、用哪个模型」。
 */
export async function* streamReplyText(
  prompt: string,
  deps: ChatEngineDeps,
  options: ReplyOptions = {}
): AsyncGenerator<string, void, unknown> {
  // 绑定服务商优先：解析成功后整条通道（provider / key / baseUrl / model）都换掉。
  let active: ResolvedRuntimeAccount = {
    provider: deps.provider,
    providerId: deps.provider.id,
    apiKey: deps.apiKey,
    baseUrl: deps.baseUrl,
    model: deps.model,
    ...(deps.params ? { params: deps.params } : {})
  }
  if (options.providerId) {
    const resolved = await deps.resolveAccount?.(options.providerId)
    if (resolved) {
      active = resolved
    }
  }

  if (resolveModeFor(active.provider, active.apiKey) === 'local') {
    yield* buildReplyChunks(prompt)
    return
  }

  const systemPrompt = options.systemPrompt?.trim() ?? ''
  const history = options.history ?? []
  const references = options.references?.trim() ?? ''
  // 参考片段拼在**用户消息里**而不是再插一条 system：部分平台对多条 system 支持不一，
  // 而用户消息各平台语义一致。
  const userContent =
    references === ''
      ? prompt
      : `以下是从工作区检索到的参考片段，回答时请标注来源：\n\n${references}\n\n问题：${prompt}`
  const messages = [
    ...(systemPrompt === '' ? [] : [{ role: 'system' as const, content: systemPrompt }]),
    ...history.map((item) => ({ role: item.role, content: item.content })),
    { role: 'user' as const, content: userContent }
  ]
  const model = options.model?.trim() ? options.model : active.model
  // 只把「这个模型真实支持哪些档」交给 provider；具体发法由各 provider 按 wire 决定。
  const capabilities = capabilitiesForSend(active.providerId, model)

  yield* active.provider.streamChat({
    apiKey: active.apiKey ?? '',
    baseUrl: active.baseUrl,
    model,
    supportedEfforts: capabilities.supportedEfforts,
    messages,
    // 单次覆盖优先，其次平台默认。params 里的 undefined 不影响对方默认值。
    params: options.params ?? active.params,
    signal: options.signal,
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(options.onUsage
      ? {
          onUsage: (usage) =>
            options.onUsage?.({ providerId: active.providerId, model, usage })
        }
      : {}),
    ...(options.onReasoning ? { onReasoning: options.onReasoning } : {})
  })
}
