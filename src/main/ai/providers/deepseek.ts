// ai/providers/deepseek —— DeepSeek 平台实现（OpenAI 兼容协议）。
//
// 只做一件事：把 HTTP + SSE 的字节流，变成「增量文本片段」。
// 不做重试、不做计费、不做消息落库——那些属于上层。
//
// 解析与请求主体已在 openaiCompatible 里通用化；这里保留 DeepSeek 的默认值与
// 类名，历史调用方和单测不受影响。
import {
  OpenAiCompatibleProvider,
  parseOpenAiSseStream
} from './openaiCompatible.ts'

export const DEEPSEEK_DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_DEFAULT_MODEL = 'deepseek-chat'

export { parseOpenAiSseStream }

export class DeepSeekProvider extends OpenAiCompatibleProvider {
  constructor() {
    super({
      id: 'deepseek',
      defaultBaseUrl: DEEPSEEK_DEFAULT_BASE_URL,
      defaultModel: DEEPSEEK_DEFAULT_MODEL
    })
  }
}
