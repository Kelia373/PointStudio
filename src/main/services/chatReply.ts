// services/chatReply —— 「假流式回复」的业务实现。
//
// 放在 services/ 而不是 ipc/：ipc 只做边界（校验参数、映射错误），业务判断归这里。
// 放在 services/ 而不是 ai/domain：domain 是纯数据与纯运算，这里带了「回复长什么样」的产品意图。
//
// 现在回复是本地生成的，不连任何模型。将来接真模型时，替换的是这个文件：
// 用 AI SDK 的 textStream 产出 AsyncIterable<string>，ipc 层的推流逻辑不用改。
import { splitIntoChunks } from '../ai/domain/chat.ts'

/** 每块的码点数。越小越像打字机，但事件也越多。 */
export const REPLY_CHUNK_SIZE = 2

/** 块与块之间的间隔，用来模拟模型吐 token 的节奏。 */
export const REPLY_CHUNK_DELAY_MS = 25

/**
 * 生成一段「回复全文」。当前是回显 + 说明，确定性输出，便于测试与对比。
 */
export function buildReplyText(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed === '') {
    return '（收到一条空消息。输入点什么，我再回你。）'
  }
  return (
    `收到：「${trimmed}」。` +
    '这是本地假流式回复——还没接任何模型，你看到的每个字都是 splitIntoChunks 一块块推回来的。' +
    '接上真模型后，只有 services/chatReply.ts 换成 AI SDK 的 textStream，上面三层不用动。'
  )
}

/**
 * 把回复全文切成推流用的块序列。
 */
export function buildReplyChunks(prompt: string): string[] {
  return splitIntoChunks(buildReplyText(prompt), REPLY_CHUNK_SIZE)
}
