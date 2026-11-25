// 单条消息。纯展示组件：只有 props，没有状态、没有副作用。
// 渲染层的硬规则——组件不碰存储、网络、模型。
import ConfirmButton from './ConfirmButton'

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
  onReference
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

      <div className="msg__body">
        {content}
        {streaming ? <span className="msg__caret" /> : null}
      </div>

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
      </div>
    </article>
  )
}
