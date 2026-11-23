// 单条消息气泡。纯展示组件：只有 props，没有状态、没有副作用。
// 这一条是渲染层的硬规则——组件不碰存储、网络、模型。
export type BubbleRole = 'user' | 'assistant'

export default function MessageBubble({
  role,
  content,
  streaming = false,
  failed = false
}: {
  role: BubbleRole
  content: string
  streaming?: boolean
  failed?: boolean
}) {
  return (
    <div className={`bubble bubble--${role}${failed ? ' bubble--failed' : ''}`}>
      <div className="bubble__role">{role === 'user' ? '你' : 'PointStudio'}</div>
      <div className="bubble__text">
        {content}
        {streaming ? <span className="bubble__caret" /> : null}
      </div>
    </div>
  )
}
