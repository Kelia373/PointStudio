// 单条消息气泡。纯展示组件：只有 props，没有状态、没有副作用。
// 这一条是渲染层的硬规则——组件不碰存储、网络、模型。
export type BubbleRole = 'user' | 'assistant'

export default function MessageBubble({
  role,
  content,
  streaming = false,
  failed = false,
  references = [],
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
  onCopy?: () => void
  onDelete?: () => void
  /** 只有用户消息能「重发」。 */
  onResend?: () => void
  onReference?: (chunkId: string) => void
}) {
  return (
    <div className={`bubble bubble--${role}${failed ? ' bubble--failed' : ''}`}>
      <div className="bubble__role">{role === 'user' ? '你' : 'PointStudio'}</div>
      <div className="bubble__text">
        {content}
        {streaming ? <span className="bubble__caret" /> : null}
      </div>
      <div className="bubble__actions">
        {onCopy ? (
          <button className="bubble__action" type="button" onClick={onCopy}>
            复制
          </button>
        ) : null}
        {onResend ? (
          <button className="bubble__action" type="button" onClick={onResend}>
            重发
          </button>
        ) : null}
        {onDelete ? (
          <button className="bubble__action" type="button" onClick={onDelete}>
            删除
          </button>
        ) : null}
      </div>

      {references.length > 0 ? (
        <div className="bubble__refs">
          引用：
          {references.map((item, index) => (
            <span key={`${item.chunkId}-${index}`}>
              {index > 0 ? '、' : ''}
              {onReference ? (
                <button
                  className="bubble__ref-link"
                  type="button"
                  title={`查看 ${item.source} 的原文片段`}
                  onClick={() => onReference(item.chunkId)}
                >
                  {item.source}
                </button>
              ) : (
                item.source
              )}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}
