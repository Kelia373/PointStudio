// ai/domain/context —— 上下文窗口的裁剪规则。
//
// 目标不是「精确算 token」（各家 tokenizer 不同、还要下载词表），而是
// **有据可依地控制规模，并且不静默丢内容**：丢了多少条必须报出来，
// 让界面有机会提示用户「前面的对话没带上」。

export type ContextRole = 'system' | 'user' | 'assistant'

export interface ContextMessage {
  role: ContextRole
  content: string
}

export interface TrimOptions {
  /** 最多保留多少条历史消息。 */
  maxMessages?: number
  /** 估算 token 预算；超出时从头丢。 */
  maxTokens?: number
}

export interface TrimResult {
  messages: ContextMessage[]
  /** 被丢掉的条数——调用方应当据此决定是否提示用户。 */
  droppedCount: number
}

/**
 * 粗估 token 数。
 *
 * 中文按 1 字 1 token（偏保守，宁可少塞），拉丁字母/数字按 4 字符 1 token。
 * 只是规模控制手段，不用于计费——计费以平台返回的 usage 为准。
 */
export function estimateTokens(text: string): number {
  if (text === '') {
    return 0
  }
  let cjk = 0
  let other = 0
  for (const char of text) {
    if (/[\u3400-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/.test(char)) {
      cjk += 1
    } else {
      other += 1
    }
  }
  return cjk + Math.ceil(other / 4)
}

/**
 * 从**最早的**消息开始丢，直到满足上限。
 *
 * 两条硬规矩：
 * 1. 最后一条消息永远保留（哪怕它自己就超预算）——它是当前这一轮，
 *    丢掉它等于什么都没问。
 * 2. 不切碎单条消息。截断会让模型看到半句话，比少一轮更容易出幻觉。
 */
export function trimHistory(history: ContextMessage[], options: TrimOptions): TrimResult {
  const { maxMessages, maxTokens } = options
  let start = 0

  if (maxMessages !== undefined && maxMessages >= 0 && history.length > maxMessages) {
    start = history.length - maxMessages
  }

  if (maxTokens !== undefined && maxTokens >= 0) {
    let used = 0
    let index = history.length - 1
    while (index >= start) {
      const cost = estimateTokens(history[index].content)
      const isLast = index === history.length - 1
      if (!isLast && used + cost > maxTokens) {
        start = index + 1
        break
      }
      used += cost
      index -= 1
    }
  }

  return {
    messages: history.slice(start),
    droppedCount: start
  }
}
