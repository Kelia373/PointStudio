// services/chatEngine —— 决定「这次回复走真模型还是本地假流式」。
//
// 放在 services 而不是 ipc：这是业务选择（有凭据就真的调模型，没有就降级），
// 不是协议细节。ipc 层只负责把它接到通道上。
import type { ChatProvider, ChatStreamParams } from '../ai/providers/types.ts'
import type { ChatMode } from '../../shared/types/ipc.ts'
import { buildReplyChunks } from './chatReply.ts'

export interface ChatEngineDeps {
  provider: ChatProvider
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
}

/** 本次会走哪条路。纯函数，界面靠它显示状态，不靠猜。 */
export function resolveMode(deps: ChatEngineDeps): ChatMode {
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
  const messages =
    systemPrompt === ''
      ? [{ role: 'user' as const, content: prompt }]
      : [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: prompt }
        ]

  yield* deps.provider.streamChat({
    apiKey: deps.apiKey ?? '',
    baseUrl: deps.baseUrl,
    model: options.model?.trim() ? options.model : deps.model,
    messages,
    params: options.params
  })
}
