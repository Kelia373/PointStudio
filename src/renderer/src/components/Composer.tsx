// 输入区：三态（发送 / 流式中 / 停止）+ 高度自适应 + Enter 发送。
// 群聊支持 @ 成员（被选中的人以高亮 chip 展示，发送时由该成员接管本轮）；
// 同时支持 / 指令：/plan 生成计划、/stop 停止生成、/clear 清空输入。
import { useEffect, useRef, useState, type ReactNode } from 'react'

import { EFFORT_LABEL, MODEL_LABEL, type Effort } from '../lib/modelOptions'
import { resolveComposerAction } from '../lib/composerCommands'
import type { ComposerModelPolicy } from '../lib/modelPicker'
import { Slot } from '../runtime/SlotRenderer'
import Icon from './Icon'

interface MentionCandidate {
  id: string
  name: string
}

interface SlashCommand {
  command: string
  label: string
}

const COMMANDS: SlashCommand[] = [
  { command: '/plan', label: '生成执行计划' },
  { command: '/stop', label: '停止生成' },
  { command: '/clear', label: '清空输入' }
]

interface MenuState {
  kind: 'mention' | 'command'
  /** 触发位置：@ 或 / 在文本里的下标。 */
  start: number
  query: string
  active: number
}

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
  modelPicker,
  mentionCandidates,
  mentionedIds,
  onMentionedChange
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
  onPlan: (goal?: string) => void
  /** 发送前的路由预判文案；null 表示不显示。 */
  routePreview?: string | null
  /**
   * 老下拉分支用的模型回调。
   * 注意：本组 prop（onModelChange / model / models）只在 `modelPolicy === undefined` 时被读取，
   * 而 ChatPanel 现在恒传 modelPolicy（且 resolveConversationComposerPolicy 带 defaultAssistantId，
   * 恒返回 locked-*），所以现网这两条分支都不可达。已定：保留，勿删（不破 chat.composer 契约）。
   */
  onModelChange: (model: string) => void
  onEffortChange: (effort: Effort) => void
  /** 会话类型决定模型入口：可编辑 / 锁定 Agent / 锁定小组。 */
  modelPolicy?: ComposerModelPolicy
  /** 锁定态显示的只读徽标。 */
  modelBadge?: ReactNode
  /** 可编辑态渲染的模型选择浮层（现网不可达，同上）。 */
  modelPicker?: ReactNode
  /** 群聊成员：输入 @ 时弹出。 */
  mentionCandidates?: MentionCandidate[]
  /** 已被 @ 的成员 id（由上层持有，发送时用来路由）。 */
  mentionedIds?: string[]
  onMentionedChange?: (ids: string[]) => void
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [hint, setHint] = useState<string | null>(null)

  const candidates = mentionCandidates ?? []
  const mentioned = mentionedIds ?? []

  // 高度自适应：内容长高就长高，但不超过 CSS 的 max-height。
  useEffect(() => {
    const node = inputRef.current
    if (!node) {
      return
    }
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [draft])

  function findMention(value: string, caret: number): MenuState | null {
    if (candidates.length === 0) {
      return null
    }
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at < 0) {
      return null
    }
    const query = before.slice(at + 1)
    // @ 后面不能出现空白，否则视为普通文本。
    if (/\s/.test(query)) {
      return null
    }
    return { kind: 'mention', start: at, query, active: 0 }
  }

  function findCommand(value: string): MenuState | null {
    if (!value.startsWith('/') || /\s/.test(value) || value.length > 20) {
      return null
    }
    return { kind: 'command', start: 0, query: value, active: 0 }
  }

  function refreshMenu(value: string, caret: number): void {
    setMenu(findCommand(value) ?? findMention(value, caret))
  }

  const mentionMatches =
    menu?.kind === 'mention'
      ? candidates.filter((item) =>
          item.name.toLowerCase().includes(menu.query.toLowerCase())
        )
      : []
  const commandMatches =
    menu?.kind === 'command'
      ? COMMANDS.filter((item) => item.command.startsWith(menu.query.toLowerCase()))
      : []
  const menuItems = menu?.kind === 'mention' ? mentionMatches.length : commandMatches.length
  const activeIndex = menu ? Math.min(menu.active, Math.max(0, menuItems - 1)) : 0

  function applyMention(candidate: MentionCandidate): void {
    const node = inputRef.current
    const caret = node?.selectionStart ?? draft.length
    const start = menu?.start ?? draft.lastIndexOf('@')
    const next = `${draft.slice(0, start)}@${candidate.name} ${draft.slice(caret)}`
    onDraftChange(next)
    if (!mentioned.includes(candidate.id)) {
      onMentionedChange?.([...mentioned, candidate.id])
    }
    setMenu(null)
    requestAnimationFrame(() => {
      node?.focus()
      const position = start + candidate.name.length + 2
      node?.setSelectionRange(position, position)
    })
  }

  function applyCommand(command: string): void {
    setMenu(null)
    if (command === '/plan') {
      // 从菜单选中 /plan 时补全成 '/plan ' 并聚焦，不立即发起规划。
      onDraftChange('/plan ')
      setHint(null)
      requestAnimationFrame(() => {
        const node = inputRef.current
        node?.focus()
        node?.setSelectionRange('/plan '.length, '/plan '.length)
      })
      return
    }
    if (command === '/stop') {
      // 菜单里点 /stop 也按「生成中可用」处理。
      if (busy) {
        onStop()
      } else {
        setHint('当前没有进行中的生成')
      }
      onDraftChange('')
      return
    }
    onDraftChange('')
  }

  /** Enter / 发送按钮共用：先解析指令，再决定发送、停止还是拦截。 */
  function handleSubmitAction(): void {
    const action = resolveComposerAction(draft, busy)
    if (action.type === 'blocked') {
      return
    }
    if (action.type === 'stop') {
      if (busy) {
        onStop()
      } else {
        setHint('当前没有进行中的生成')
      }
      onDraftChange('')
      return
    }
    if (action.type === 'clear') {
      onDraftChange('')
      return
    }
    if (action.type === 'plan-needs-goal') {
      setHint('在 /plan 后面写目标，例如：/plan 修复登录')
      return
    }
    if (action.type === 'plan') {
      onPlan(action.goal)
      onDraftChange('')
      return
    }
    onSend()
  }

  function removeMention(candidate: MentionCandidate): void {
    onMentionedChange?.(mentioned.filter((id) => id !== candidate.id))
    const token = `@${candidate.name}`
    const index = draft.indexOf(token)
    if (index < 0) {
      return
    }
    const end = index + token.length
    // 只吃掉 @名字 后面那一个分隔空格，不动用户自己的排版。
    onDraftChange(draft.slice(0, index) + draft.slice(draft[end] === ' ' ? end + 1 : end))
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (menu && menuItems > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setMenu({ ...menu, active: (activeIndex + delta + menuItems) % menuItems })
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        if (menu.kind === 'mention') {
          applyMention(mentionMatches[activeIndex])
        } else {
          applyCommand(commandMatches[activeIndex].command)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      handleSubmitAction()
    }
  }

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmitAction()
      }}
    >
      <div className="composer__box">
        {mentioned.length > 0 ? (
          <div className="composer__mentions" aria-label="已 @ 的成员">
            {mentioned.map((id) => {
              const candidate = candidates.find((item) => item.id === id)
              if (!candidate) {
                return null
              }
              return (
                <span key={id} className="composer__mention">
                  @{candidate.name}
                  <button
                    type="button"
                    className="composer__mention-x"
                    aria-label={`取消 @${candidate.name}`}
                    onClick={() => removeMention(candidate)}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        ) : null}

        {hint ? <p className="composer__hint">{hint}</p> : null}

        {mentioned.length > 1 ? (
          <p className="composer__hint">
            已 @ 多个成员：本轮仍由组长回答（多 Agent 同室排后续）
          </p>
        ) : null}

        {menu && menuItems > 0 ? (
          <div className="composer__menu" role="listbox" aria-label="指令或成员">
            {menu.kind === 'mention'
              ? mentionMatches.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`composer__menu-item${index === activeIndex ? ' is-on' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyMention(item)
                    }}
                  >
                    <span>@{item.name}</span>
                  </button>
                ))
              : commandMatches.map((item, index) => (
                  <button
                    key={item.command}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`composer__menu-item${index === activeIndex ? ' is-on' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyCommand(item.command)
                    }}
                  >
                    <code>{item.command}</code>
                    <span>{item.label}</span>
                  </button>
                ))}
          </div>
        ) : null}

        <textarea
          ref={inputRef}
          className="composer__input"
          value={draft}
          rows={1}
          placeholder="输入消息，Enter 发送，Shift+Enter 换行；@ 成员，/ 指令"
          onChange={(event) => {
            const value = event.target.value
            setHint(null)
            onDraftChange(value)
            refreshMenu(value, event.target.selectionStart)
            // 手动删掉 @名字 时，把对应 chip 一并撤掉，避免发送时路由到没提到的人。
            const stillMentioned = mentioned.filter((id) => {
              const candidate = candidates.find((item) => item.id === id)
              return candidate ? value.includes(`@${candidate.name}`) : false
            })
            if (stillMentioned.length !== mentioned.length) {
              onMentionedChange?.(stillMentioned)
            }
          }}
          onKeyDown={handleKeyDown}
        />
        <div className="composer__bar">
          {/* 老的下拉分支：ChatPanel 现已恒传 modelPolicy（locked-*），这段在现网不可达；
              已定：保留，勿删（不破 chat.composer 契约）。 */}
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
                  : '群聊：输入 @ 指定成员接管本轮'
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
            onClick={() => onPlan()}
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
