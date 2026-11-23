/**
 * 单条消息气泡。纯展示组件：只有 props，没有状态、没有副作用。
 * 这一条是渲染层的硬规则——组件不碰存储、网络、模型。
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  streaming: boolean
}

export default function MessageBubble({ message }: { message: ChatMessage }) {
  return (
    <div className={`bubble bubble--${message.role}`}>
      <div className="bubble__role">{message.role === 'user' ? '你' : 'PointStudio'}</div>
      <div className="bubble__text">
        {message.text}
        {message.streaming ? <span className="bubble__caret" /> : null}
      </div>
    </div>
  )
}
