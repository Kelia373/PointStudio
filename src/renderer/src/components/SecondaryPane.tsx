// 副画布：主舞台右侧的通用第二窗格（会话对照 / 功能页 / Markdown 草稿）。
//
// 只读展示会话，不在副画布上发消息：发送仍然只有主舞台一处入口，
// 避免「两个输入框同时往一个会话里写」这种必然对不齐的状态。
import { useEffect, useMemo, useState } from 'react'
import type { ComponentType } from 'react'

import type { AgentWorkerRunDto, ConversationDto, HandoffEnvelopeDto, MessageDto } from '../../../shared/types/ipc.ts'
import { downloadText, exportFileName } from '../lib/exportFile'
import { renderMarkdown } from '../lib/markdownLite'
import { buildMissionChains } from '../lib/missionTrace'
import type { UiMessage } from '../lib/chatState'
import type { SecondaryPaneKind, SplitPaneState } from '../lib/splitView'
import { PluginErrorBoundary } from '../runtime/guard'
import { registry } from '../runtime/registry'
import { useRegistryVersion } from '../runtime/SlotRenderer'
import Icon from './Icon'

const KIND_LABEL: Record<SecondaryPaneKind, string> = {
  session: '会话',
  page: '功能页',
  markdown: 'Markdown',
  trace: '任务链'
}

const MISSION_STATUS_LABEL: Record<string, string> = {
  queued: '排队中',
  working: '执行中',
  waiting: '等待确认',
  error: '异常',
  completed: '已完成'
}

export interface SecondaryPaneProps {
  state: SplitPaneState
  conversations: ConversationDto[]
  /** 主群当前消息：任务链视图据此还原交接现场。 */
  messages: UiMessage[]
  /** 真实派生出来的并发 Run：任务链视图显示进度。 */
  workerRuns: AgentWorkerRunDto[]
  /** agentId → 显示名；'owner' 由本组件显示成「主人」。 */
  agentNameOf?: (agentId: string) => string
  /** 主窗格当前会话：挑选副会话时默认避开它。 */
  primarySessionId: string | null
  onChange: (
    patch: Partial<Pick<SplitPaneState, 'kind' | 'sessionId' | 'pageId' | 'markdownText' | 'traceMissionId'>>
  ) => void
  onClose: () => void
  /** 把草稿插到主输入框（不直接发送）。 */
  onInsertToComposer: (text: string) => void
  /** 功能页里的跳转仍然作用在主舞台。 */
  onNavigate: (pageId: string) => void
}

export default function SecondaryPane({
  state,
  conversations,
  messages,
  workerRuns,
  agentNameOf = (agentId) => agentId,
  primarySessionId,
  onChange,
  onClose,
  onInsertToComposer,
  onNavigate
}: SecondaryPaneProps) {
  const [sessionMessages, setSessionMessages] = useState<MessageDto[]>([])
  const [loading, setLoading] = useState(false)
  const [mdMode, setMdMode] = useState<'edit' | 'preview'>('edit')
  const version = useRegistryVersion()
  const pages = useMemo(() => registry.getPages(), [version])

  // 会话对照：副窗格自己拉一遍消息，不碰主舞台的 store 切片
  useEffect(() => {
    if (state.kind !== 'session' || !state.sessionId) {
      setSessionMessages([])
      return
    }
    let cancelled = false
    setLoading(true)
    void window.pointstudio.conversations
      .messages(state.sessionId)
      .then((items) => {
        if (!cancelled) {
          setSessionMessages(items)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [state.kind, state.sessionId])

  const pageEntry = state.kind === 'page' ? registry.getPage(state.pageId) : null
  const PageComponent = pageEntry
    ? (pageEntry.def.component as ComponentType<{ navigate: (pageId: string) => void }>)
    : null
  const secondarySession =
    state.kind === 'session'
      ? conversations.find((item) => item.id === state.sessionId) ?? null
      : null
  const characterCount = state.markdownText.trim().length

  // 任务链视图只读真实数据：消息里的 handoff + 派生出来的 workerRuns
  const chains = state.kind === 'trace' ? buildMissionChains(messages, workerRuns) : []
  const chain =
    state.traceMissionId !== null
      ? chains.find((item) => item.missionId === state.traceMissionId) ?? null
      : chains[0] ?? null
  const chainHandoffs: HandoffEnvelopeDto[] = chain
    ? messages
        .map((message) => message.handoff)
        .filter(
          (item): item is HandoffEnvelopeDto =>
            item !== null && item !== undefined && item.missionId === chain.missionId
        )
    : []
  const nameOf = (agentId: string): string =>
    agentId === 'owner' ? '主人' : agentNameOf(agentId)

  return (
    <section className="secondary" aria-label="副画布">
      <div className="secondary__bar">
        <select
          className="secondary__select secondary__select--kind"
          value={state.kind}
          aria-label="副画布类型"
          onChange={(event) => onChange({ kind: event.target.value as SecondaryPaneKind })}
        >
          {(Object.keys(KIND_LABEL) as SecondaryPaneKind[]).map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>

        {state.kind === 'session' ? (
          <select
            className="secondary__select"
            value={state.sessionId ?? ''}
            aria-label="选择对照会话"
            onChange={(event) => onChange({ sessionId: event.target.value || null })}
          >
            <option value="">选择会话…</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.id === primarySessionId ? '· ' : ''}
                {conversation.title}
              </option>
            ))}
          </select>
        ) : null}

        {state.kind === 'page' ? (
          <select
            className="secondary__select"
            value={state.pageId}
            aria-label="选择功能页"
            onChange={(event) => onChange({ pageId: event.target.value })}
          >
            {pages.map((entry) => (
              <option key={entry.def.id} value={entry.def.id}>
                {entry.def.title}
              </option>
            ))}
          </select>
        ) : null}

        {state.kind === 'markdown' ? (
          <span className="secondary__seg" role="group" aria-label="Markdown 模式">
            <button
              className={`secondary__seg-btn${mdMode === 'edit' ? ' is-on' : ''}`}
              type="button"
              onClick={() => setMdMode('edit')}
            >
              编辑
            </button>
            <button
              className={`secondary__seg-btn${mdMode === 'preview' ? ' is-on' : ''}`}
              type="button"
              onClick={() => setMdMode('preview')}
            >
              预览
            </button>
          </span>
        ) : null}

        <span className="secondary__spacer" />

        <button
          className="secondary__icon"
          type="button"
          onClick={onClose}
          title="关闭分屏"
          aria-label="关闭分屏"
        >
          <Icon name="x" size={13} />
        </button>
      </div>

      <div className="secondary__body">
        {state.kind === 'session' ? (
          secondarySession === null ? (
            <p className="secondary__empty">
              还没有可对照的会话。先在左侧建一条，或把副画布切到「功能页」。
            </p>
          ) : loading ? (
            <p className="secondary__empty">正在读取消息…</p>
          ) : sessionMessages.length === 0 ? (
            <p className="secondary__empty">「{secondarySession.title}」还没有消息。</p>
          ) : (
            sessionMessages.map((message) => (
              <article key={message.id} className={`secondary__msg secondary__msg--${message.role}`}>
                <span className="secondary__msg-role">
                  {message.role === 'user' ? '我' : 'AI'}
                </span>
                <div className="secondary__msg-body">{message.content}</div>
              </article>
            ))
          )
        ) : null}

        {state.kind === 'trace' ? (
          chain === null ? (
            <p className="secondary__empty">
              {chains.length > 0
                ? '这条任务链已经不在当前会话里了。'
                : '还没有任务链。用顶栏换一位 Agent 接力后，这里会出现真实的交接记录。'}
            </p>
          ) : (
            <div className="trace">
              <div className="trace__head">
                <span className="trace__title">{chain.title}</span>
                <span className={`trace__status trace__status--${chain.status}`}>
                  {MISSION_STATUS_LABEL[chain.status] ?? chain.status}
                </span>
              </div>
              <div className="trace__meta">
                {chain.participants.map(nameOf).join(' → ')} · {chain.messageCount} 条消息 ·{' '}
                {chain.activeRunCount} 个活跃 Run
              </div>
              {chain.progress ? (
                <div className="trace__progress">
                  {chain.progress.stepLabel} · {chain.progress.current}/{chain.progress.total}
                </div>
              ) : null}
              {chainHandoffs.map((item) => (
                <section key={item.handoffId} className="trace__handoff">
                  <div className="trace__handoff-head">
                    {nameOf(item.fromAgentId)} → {nameOf(item.toAgentId)} · {item.summary}
                  </div>
                  <pre className="trace__payload">{item.payloadMarkdown}</pre>
                </section>
              ))}
            </div>
          )
        ) : null}

        {state.kind === 'page' ? (
          pageEntry && PageComponent ? (
            <PluginErrorBoundary pluginId={pageEntry.pluginId}>
              <PageComponent navigate={onNavigate} />
            </PluginErrorBoundary>
          ) : (
            <p className="secondary__empty">这个功能页已经不在注册表里了。</p>
          )
        ) : null}

        {state.kind === 'markdown' ? (
          <div className="md">
            {mdMode === 'edit' ? (
              <textarea
                className="md__input"
                value={state.markdownText}
                placeholder="在这里写点东西：支持标题、列表、代码块、粗体与行内代码。草稿会自动保存。"
                aria-label="Markdown 草稿"
                onChange={(event) => onChange({ markdownText: event.target.value })}
              />
            ) : (
              <div
                className="md__preview"
                // renderMarkdown 先转义再替换标记，输出只包含本组件生成的标签
                dangerouslySetInnerHTML={{ __html: renderMarkdown(state.markdownText) }}
              />
            )}
            <div className="md__foot">
              <span className="md__count">{characterCount} 字</span>
              <button
                className="secondary__action"
                type="button"
                disabled={state.markdownText.trim() === ''}
                onClick={() => onInsertToComposer(state.markdownText)}
              >
                插入对话
              </button>
              <button
                className="secondary__action"
                type="button"
                disabled={state.markdownText.trim() === ''}
                onClick={() => downloadText(exportFileName('Markdown 草稿'), state.markdownText)}
              >
                导出 .md
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
