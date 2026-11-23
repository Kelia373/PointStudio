// services/chatFlow —— 一次问答的编排：先落用户消息，再流式产出，最后落助手消息。
//
// 为什么单独一层：它既不属于「怎么调模型」（chatEngine），也不属于「怎么存」
// （conversationService）。它决定的是顺序与失败语义——这部分最容易出错，
// 也最需要测试：用户消息不能因为模型报错就跟着丢掉。
import type { ConversationService } from './conversationService.ts'
import { streamReplyText, type ChatEngineDeps } from './chatEngine.ts'

export interface ChatFlowDeps {
  conversations: ConversationService
  engine: ChatEngineDeps
}

/**
 * 产出助手回复的增量文本，同时把这一轮问答写进会话。
 *
 * 失败语义：
 * - 会话不存在 → 抛错，什么都不写；
 * - 用户消息一定先落库，模型失败也不会丢用户说过的话；
 * - 回复中途失败 → 已产出的部分照常保留，助手消息标记 `error`。
 */
export async function* streamAssistantReply(
  conversationId: string,
  prompt: string,
  deps: ChatFlowDeps
): AsyncGenerator<string, void, unknown> {
  const saved = await deps.conversations.appendMessage(conversationId, {
    role: 'user',
    content: prompt
  })
  if (!saved.ok) {
    throw new Error(saved.errors[0] ?? 'E_UNKNOWN')
  }

  let accumulated = ''
  try {
    for await (const chunk of streamReplyText(prompt, deps.engine)) {
      accumulated += chunk
      yield chunk
    }
  } catch (error) {
    // 一行都没产出时给个占位，否则界面上会出现一条空白气泡。
    await deps.conversations.appendMessage(conversationId, {
      role: 'assistant',
      content: accumulated === '' ? '（回复失败）' : accumulated,
      status: 'error'
    })
    throw error
  }

  await deps.conversations.appendMessage(conversationId, {
    role: 'assistant',
    content: accumulated
  })
}
