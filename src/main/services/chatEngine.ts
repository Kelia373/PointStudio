// services/chatEngine —— 决定「这次回复走真模型还是本地假流式」。
//
// 放在 services 而不是 ipc：这是业务选择（有凭据就真的调模型，没有就降级），
// 不是协议细节。ipc 层只负责把它接到通道上。
import type { ChatProvider, ChatStreamParams } from '../ai/providers/types.ts'
import type { ProviderParams } from '../ai/domain/providerSettings.ts'
import type { ContextMessage } from '../ai/domain/context.ts'
import type { ChatMode } from '../../shared/types/ipc.ts'
import { buildReplyChunks } from './chatReply.ts'

export interface ChatEngineDeps {
  provider: ChatProvider
  /** 平台默认采样参数；单次调用可用 ReplyOptions.params 覆盖。 */
  params?: ProviderParams
  /** null / 空串表示没有可用凭据，走本地假回复。 */
  apiKey: string | null
  baseUrl: string
  model: string
}

/** 单次调用可覆盖的部分：来自助手绑定，缺省则用引擎默认值。 */
export interface ReplyOptions {
  systemPrompt?: string
  model?: string
  params?: ChatStreamParams
  /** 已裁剪过的历史消息（不含本轮输入）。 */
  history?: ContextMessage[]
  /** 检索到的参考片段（已格式化）。非空时拼在本轮输入前面，并保留来源标注。 */
  references?: string
}

/**
 * 本次会走哪条路。纯函数，界面靠它显示状态，不靠猜。
 *
 * 判断依据有两条：平台是否要求凭据、以及有没有凭据。
 * 本地模型（requiresApiKey === false）即使没 Key 也走真模型。
 */
export function resolveMode(deps: ChatEngineDeps): ChatMode {
  if (deps.provider.requiresApiKey === false) {
    return 'live'
  }
  return (deps.apiKey?.trim() ?? '') === '' ? 'local' : 'live'
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
  if (resolveMode(deps) === 'local') {
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

  yield* deps.provider.streamChat({
    apiKey: deps.apiKey ?? '',
    baseUrl: deps.baseUrl,
    model: options.model?.trim() ? options.model : deps.model,
    messages,
    // 单次覆盖优先，其次平台默认。params 里的 undefined 不影响对方默认值。
    params: options.params ?? deps.params
  })
}
