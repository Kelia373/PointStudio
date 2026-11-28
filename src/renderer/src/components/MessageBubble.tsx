// 单条消息。纯展示组件：只有 props，没有状态、没有副作用。
// 渲染层的硬规则——组件不碰存储、网络、模型。
import { useState } from 'react'

import type { HandoffEnvelopeDto, RouteDecisionDto } from '../../../shared/types/ipc.ts'
import { Slot } from '../runtime/SlotRenderer'
import ConfirmButton from './ConfirmButton'
import DualTrack from './DualTrack'
import HandoffPill from './HandoffPill'
import MemorySpark from './MemorySpark'
import RouteBadge from './RouteBadge'
import BrandLogo from './BrandLogo'
import ThinkingBlock from './ThinkingBlock'

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
  onEscalate,
  route,
  memory,
  handoff = null,
  handoffFrom = '主人',
  handoffTo = '',
  onOpenInSplit,
  reasoning,
  reasoningMs,
  streamingReasoning = false,
  onEdit,
  onBranch
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
  /** 有它就显示「⚡ 升档重试」：调用方只在确实还有更强一棒时才传。 */
  onEscalate?: () => void
  /** 这一轮的路由决策；没有就只显示普通气泡。 */
  route?: RouteDecisionDto | null
  /** 有了它才显示「钉入记忆」：记忆是 Agent 私域，没绑定 Agent 就没有意义。 */
  memory?: {
    agentId: string | null
    workspaceId: string | null
    sessionId: string | null
    agentName: string
    onChanged: () => void
  }
  /** 有交接信封时整条消息渲染成一行瘦胶囊，不显示普通聊天气泡。 */
  handoff?: HandoffEnvelopeDto | null
  handoffFrom?: string
  handoffTo?: string
  onOpenInSplit?: () => void
  /** 模型思考内容；有值时在正文上方渲染折叠卡。 */
  reasoning?: string
  reasoningMs?: number
  streamingReasoning?: boolean
  /** 用户消息：原位编辑并重发。 */
  onEdit?: (next: string) => void
  /** 通用：从此处分叉为新会话。 */
  onBranch?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftEdit, setDraftEdit] = useState(content)
  function commitEdit(): void {
    const next = draftEdit.trim()
    if (next === '' || !onEdit) {
      return
    }
    setEditing(false)
    onEdit(next)
  }

  if (handoff) {
    return (
      <HandoffPill
        handoff={handoff}
        fromName={handoffFrom}
        toName={handoffTo}
        onOpenInSplit={onOpenInSplit}
      />
    )
  }

  return (
    <article
      className={`msg msg--${role}${failed ? ' msg--failed' : ''}`}
      style={{ ['--i' as string]: String(Math.min(index, 8)) }}
    >
      <div className="msg__head">
        <span className="msg__author">
          {role === 'user' ? null : (
            <BrandLogo variant="mark" size={13} className="msg__brand" />
          )}
          {role === 'user' ? '你' : 'PointStudio'}
        </span>
        {at ? <span>{at}</span> : null}
        {failed ? <span>· 失败</span> : null}
        {route ? <RouteBadge decision={route} /> : null}
      </div>

      {role === 'assistant' ? (
        <>
          {reasoning && reasoning.trim() !== '' ? (
            <ThinkingBlock
              reasoning={reasoning}
              streamingReasoning={streamingReasoning}
              durationMs={reasoningMs}
            />
          ) : null}
          <DualTrack content={content} streaming={streaming} />
        </>
      ) : editing ? (
        <div className="msg__edit">
          <textarea
            className="msg__edit-input"
            value={draftEdit}
            autoFocus
            rows={3}
            onChange={(event) => setDraftEdit(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                setEditing(false)
              }
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault()
                commitEdit()
              }
            }}
          />
          <div className="msg__edit-actions">
            <button
              className="msg__act"
              type="button"
              onClick={commitEdit}
              disabled={draftEdit.trim() === '' || streaming}
            >
              保存并重发
            </button>
            <button className="msg__act" type="button" onClick={() => setEditing(false)}>
              取消
            </button>
          </div>
        </div>
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
        {role === 'user' && onEdit ? (
          <button
            className="msg__act"
            type="button"
            title="编辑后从这句重新发"
            disabled={streaming}
            onClick={() => {
              setDraftEdit(content)
              setEditing(true)
            }}
          >
            编辑
          </button>
        ) : null}
        {onBranch ? (
          <button
            className="msg__act"
            type="button"
            title="从此处分叉为新对话"
            onClick={onBranch}
          >
            分叉
          </button>
        ) : null}
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
        {onEscalate ? (
          <button
            className="msg__act msg__act--route"
            type="button"
            onClick={onEscalate}
            title="换用更强的一档模型重发这一轮"
          >
            ⚡ 升档重试
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
