// 单条消息。纯展示组件：只有 props，没有状态、没有副作用。
// 渲染层的硬规则——组件不碰存储、网络、模型。
import { Slot } from '../runtime/SlotRenderer'
import ConfirmButton from './ConfirmButton'
import DualTrack from './DualTrack'
import MemorySpark from './MemorySpark'

export type BubbleRole = 'user' | 'assistant'

export default function MessageBubble({
  role,
  content,
  streaming = false,
  failed = false,
  references = [],
  at,
  index = 0,
  onCopy,
  onDelete,
  onResend,
  onReference,
  memory
}: {
  role: BubbleRole
  content: string
  streaming?: boolean
  failed?: boolean
  references?: Array<{ chunkId: string; source: string }>
  /** 消息时间，只有落库的消息有；乐观渲染的气泡为空。 */
  at?: string
  /** 入场级联序号，用于 stagger。 */
  index?: number
  onCopy?: () => void
  onDelete?: () => void
  /** 只有用户消息能「重发」。 */
  onResend?: () => void
  onReference?: (chunkId: string) => void
  /** 有了它才显示「钉入记忆」：记忆是 Agent 私域，没绑定 Agent 就没有意义。 */
  memory?: {
    agentId: string | null
    workspaceId: string | null
    sessionId: string | null
    agentName: string
    onChanged: () => void
  }
}) {
  return (
    <article
      className={`msg msg--${role}${failed ? ' msg--failed' : ''}`}
      style={{ ['--i' as string]: String(Math.min(index, 8)) }}
    >
      <div className="msg__head">
        <span>{role === 'user' ? '你' : 'PointStudio'}</span>
        {at ? <span>{at}</span> : null}
        {failed ? <span>· 失败</span> : null}
      </div>

      {role === 'assistant' ? (
        // 长回答走双轨：同一块地方在「结论 / 过程」之间原地换镜头。
        <DualTrack content={content} streaming={streaming} />
      ) : (
        <div className="msg__body">
          {content}
          {streaming ? <span className="msg__caret" /> : null}
        </div>
      )}

      {references.length > 0 ? (
        <div className="msg__refs">
          <span>引用</span>
          {references.map((item, refIndex) => (
            <button
              key={`${item.chunkId}-${refIndex}`}
              className="msg__ref"
              type="button"
              title={`查看 ${item.source} 的原文片段`}
              onClick={() => onReference?.(item.chunkId)}
              disabled={!onReference}
            >
              {item.source}
            </button>
          ))}
        </div>
      ) : null}

      <div className="msg__acts">
        {onCopy ? (
          <button className="msg__act" type="button" onClick={onCopy}>
            复制
          </button>
        ) : null}
        {onResend ? (
          <button className="msg__act" type="button" onClick={onResend} title="用这句话再发一次">
            重发
          </button>
        ) : null}
        {onDelete ? (
          <ConfirmButton
            className="msg__act msg__act--danger"
            label="删除"
            confirmLabel="删整轮?"
            title="删除这一轮问答"
            onConfirm={onDelete}
          />
        ) : null}
        {role === 'assistant' && memory ? (
          <MemorySpark
            agentId={memory.agentId}
            workspaceId={memory.workspaceId}
            sessionId={memory.sessionId}
            agentName={memory.agentName}
            content={content}
            onChanged={memory.onChanged}
          />
        ) : null}
        <Slot name="chat.message.actions" props={{ role, content, at: at ?? null }} />
      </div>
    </article>
  )
}
