// services/exportService —— 把一段会话导出成 Markdown。
//
// 目的很实际：产物要能带得走。整库备份是给"换设备"用的，
// 单会话导出是给"贴进文档 / 发给同事"用的，两者不能互相替代。
//
// 纯函数：不读写文件、不碰 electron，可直接测。
import type { Conversation, Message } from '../ai/domain/conversation.ts'

export interface ExportOptions {
  /** 是否附上引用来源，默认 true。 */
  includeReferences?: boolean
}

function formatTime(iso: string): string {
  // 只保留到分钟，导出文档不需要毫秒精度。
  return iso.length >= 16 ? iso.slice(0, 16).replace('T', ' ') : iso
}

export function renderConversationMarkdown(
  conversation: Conversation,
  messages: Message[],
  options: ExportOptions = {}
): string {
  const includeReferences = options.includeReferences ?? true
  const lines: string[] = [`# ${conversation.title}`, '']

  if (conversation.createdAt) {
    lines.push(`> 导出自 PointStudio · ${formatTime(conversation.createdAt)}`, '')
  }

  if (messages.length === 0) {
    lines.push('（这个会话还没有消息。）', '')
    return lines.join('\n')
  }

  for (const message of messages) {
    const speaker = message.role === 'user' ? '你' : 'PointStudio'
    const failed = message.status === 'error' ? '（本次回复失败）' : ''
    lines.push(`**${speaker}**${failed}　*${formatTime(message.createdAt)}*`)
    lines.push('')
    // 原样保留内容：代码块、列表、引用都不能被转义破坏。
    if (message.reasoning) {
      lines.push('<details><summary>深度思考</summary>')
      lines.push('')
      lines.push(message.reasoning)
      lines.push('')
      lines.push('</details>')
      lines.push('')
    }
    lines.push(message.content)
    lines.push('')

    if (includeReferences && message.references && message.references.length > 0) {
      const sources = [...new Set(message.references.map((item) => item.source))]
      lines.push(`> 引用：${sources.join('、')}`)
      lines.push('')
    }
  }

  return lines.join('\n')
}
