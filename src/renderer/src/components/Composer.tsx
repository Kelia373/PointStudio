// 输入区：三态（发送 / 流式中 / 停止）+ 高度自适应 + Enter 发送。
// 模型入口按会话类型分三种：自由对话可编辑、绑定 Agent 只读、小组只读。
import { useEffect, useRef, type ReactNode } from 'react'

import { EFFORT_LABEL, MODEL_LABEL, type Effort } from '../lib/modelOptions'
import type { ComposerModelPolicy } from '../lib/modelPicker'
import { Slot } from '../runtime/SlotRenderer'
import Icon from './Icon'

export default function Composer({
  draft,
  busy,
  canSend,
  model,
  models,
  effort,
  onDraftChange,
  onSend,
  onStop,
  onPlan,
  routePreview,
  onModelChange,
  onEffortChange,
  modelPolicy,
  modelBadge,
  modelPicker
}: {
  draft: string
  busy: boolean
  canSend: boolean
  /** 当前会话生效的模型名（可能来自会话覆盖或全局默认）。 */
  model: string
  /** 下拉可选项，第一项是当前值。 */
  models: string[]
  /** 当前思考等级；null 表示没设过。 */
  effort: Effort | null
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onPlan: () => void
  /** 发送前的路由预判文案；null 表示不显示。 */
  routePreview?: string | null
  onModelChange: (model: string) => void
  onEffortChange: (effort: Effort) => void
  /** 会话类型决定模型入口：可编辑 / 锁定 Agent / 锁定小组。 */
  modelPolicy?: ComposerModelPolicy
  /** 锁定态显示的只读徽标。 */
  modelBadge?: ReactNode
  /** 可编辑态渲染的模型选择浮层。 */
  modelPicker?: ReactNode
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // 高度自适应：内容长高就长高，但不超过 CSS 的 max-height。
  useEffect(() => {
    const node = inputRef.current
    if (!node) {
      return
    }
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [draft])

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy) {
          onSend()
        }
      }}
    >
      <div className="composer__box">
        <textarea
          ref={inputRef}
          className="composer__input"
          value={draft}
          rows={1}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行"
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (!busy) {
                onSend()
              }
            }
          }}
        />
        <div className="composer__bar">
          {modelPolicy === undefined ? (
            <>
              <label className="composer__pick" title="本次执行使用的模型（只影响这个会话）">
                <select
                  value={model}
                  onChange={(event) => onModelChange(event.target.value)}
                  aria-label="选择模型"
                >
                  {models.length === 0 ? <option value="">默认模型</option> : null}
                  {models.map((item) => (
                    <option key={item} value={item}>
                      {MODEL_LABEL[item] ?? item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="composer__pick" title="思考预算：低 1k / 中 2k / 高 4k 输出上限">
                <select
                  value={effort ?? ''}
                  onChange={(event) => {
                    if (event.target.value !== '') {
                      onEffortChange(event.target.value as Effort)
                    }
                  }}
                  aria-label="思考等级"
                >
                  <option value="">思考 默认</option>
                  {(Object.keys(EFFORT_LABEL) as Effort[]).map((level) => (
                    <option key={level} value={level}>
                      思考 {EFFORT_LABEL[level]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : modelPolicy.mode === 'editable' ? (
            modelPicker ?? null
          ) : (
            <span
              className="composer__model-badge"
              title={
                modelPolicy.mode === 'locked-agent'
                  ? '模型由该 Agent 的绑定决定，点击去右侧检查器修改'
                  : '小组里各成员按各自绑定走模型'
              }
            >
              {modelBadge}
            </span>
          )}

          {routePreview ? <span className="composer__route">{routePreview}</span> : null}
          <Slot name="chat.composer.toolbar" props={{ draft, busy }} />

          <span className="composer__spacer" />
          <button
            className="msg__act"
            type="button"
            onClick={onPlan}
            disabled={busy || draft.trim() === ''}
            title="把这句话交给 Agent 生成执行计划"
          >
            <Icon name="compass" size={14} />
            计划
          </button>
          {busy ? (
            <button className="btn-stop" type="button" onClick={onStop}>
              停止
            </button>
          ) : (
            <button className="btn-send" type="submit" disabled={!canSend}>
              发送
            </button>
          )}
        </div>
      </div>
    </form>
  )
}
