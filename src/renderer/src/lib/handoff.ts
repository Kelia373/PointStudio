// lib/handoff —— 把「顶栏换 Agent 接力」变成一条真实的交接记录。
//
// 不做假数据：只有用户真的在会话里换了接手人，才会调用这里生成 HandoffEnvelopeDto。
import type { HandoffEnvelopeDto } from '../../../shared/types/ipc.ts'
import type { UiMessage } from './chatState.ts'

export interface BuildHandoffInput {
  handoffId: string
  missionId: string
  previous: { id: string; name: string } | null
  next: { id: string; name: string }
  /** 交接前的消息；用来摘一段真实上下文，而不是空话。 */
  messages: UiMessage[]
}

const CONTEXT_LIMIT = 400

function lastConclusion(messages: UiMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'assistant' && message.content.trim() !== '') {
      const text = message.content.trim()
      return text.length > CONTEXT_LIMIT ? `${text.slice(0, CONTEXT_LIMIT)}…` : text
    }
  }
  return '（还没有可交接的结论）'
}

export function buildHandoffEnvelope(input: BuildHandoffInput): HandoffEnvelopeDto {
  const fromName = input.previous?.name ?? '主人'
  return {
    handoffId: input.handoffId,
    missionId: input.missionId,
    fromAgentId: input.previous?.id ?? 'owner',
    toAgentId: input.next.id,
    kind: 'handoff',
    summary: `将会话交接给 ${input.next.name} 接力处理`,
    payloadMarkdown: [
      `# 交接给 ${input.next.name}`,
      '',
      `- 从：${fromName}`,
      `- 到：${input.next.name}`,
      '',
      '## 交接前的最后一条结论',
      '',
      lastConclusion(input.messages)
    ].join('\n'),
    status: 'accepted'
  }
}
