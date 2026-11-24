// 右检查器：上下文 / 工具调用 / 运行 三个视图。
// 原则：只显示真实有的数据；拿不到的一律显示「未接入 / 未统计」，不编数字。
import type {
  McpConnectionDto,
  ProviderSettingsViewDto
} from '../../../shared/types/ipc.ts'
import type { PlanRunState } from '../lib/planRunState'

export type InspectorTab = 'context' | 'tools' | 'run'

const TAB_LABEL: Record<InspectorTab, string> = {
  context: '上下文',
  tools: '工具调用',
  run: '运行'
}

const STATUS_LABEL: Record<string, string> = {
  pending: '待执行',
  running: '执行中',
  success: '成功',
  failed: '失败',
  skipped: '跳过'
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '—'
  }
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`
}

export default function Inspector({
  tab,
  onTab,
  collapsed,
  onToggleCollapsed,
  conversationTitle,
  assistantName,
  mode,
  messageCount,
  referenceCount,
  provider,
  lastRunMs,
  planRun,
  mcpConnections
}: {
  tab: InspectorTab
  onTab: (tab: InspectorTab) => void
  collapsed: boolean
  onToggleCollapsed: () => void
  conversationTitle: string | null
  assistantName: string | null
  mode: 'live' | 'local' | null
  messageCount: number
  referenceCount: number
  provider: ProviderSettingsViewDto | null
  lastRunMs: number | null
  planRun: PlanRunState | null
  mcpConnections: McpConnectionDto[]
}) {
  const params = provider?.params ?? {}
  const details = planRun?.details ?? []
  const steps = planRun?.plan?.steps ?? []

  return (
    <aside className="insp" hidden={collapsed}>
      <div className="insp__tabs">
        {(Object.keys(TAB_LABEL) as InspectorTab[]).map((key) => (
          <button
            key={key}
            className={`insp__tab${tab === key ? ' insp__tab--on' : ''}`}
            type="button"
            onClick={() => onTab(key)}
          >
            {TAB_LABEL[key]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          className="icon-btn"
          type="button"
          onClick={onToggleCollapsed}
          title="收起检查器"
          aria-label="收起检查器"
        >
          »
        </button>
      </div>

      <div className="insp__body">
        {tab === 'context' ? (
          <>
            <div className="insp__group">
              <span className="insp__label">当前会话</span>
              <div className="kv">
                <span className="kv__k">标题</span>
                <span className="kv__v" title={conversationTitle ?? ''}>
                  {conversationTitle ?? '—'}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">助手</span>
                <span className="kv__v">{assistantName ?? '未绑定'}</span>
              </div>
              <div className="kv">
                <span className="kv__k">模式</span>
                <span className="kv__v">
                  {mode === 'live' ? '真模型' : mode === 'local' ? '本地假流式' : '尚未发送'}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">消息</span>
                <span className="kv__v">{messageCount} 条</span>
              </div>
              <div className="kv">
                <span className="kv__k">引用</span>
                <span className="kv__v">{referenceCount} 处</span>
              </div>
            </div>

            <div className="insp__group">
              <span className="insp__label">模型</span>
              <div className="kv">
                <span className="kv__k">平台</span>
                <span className="kv__v">{provider?.providerId ?? '未配置'}</span>
              </div>
              <div className="kv">
                <span className="kv__k">模型名</span>
                <span className="kv__v" title={provider?.model ?? ''}>
                  {provider?.model || '默认'}
                </span>
              </div>
              <div className="kv">
                <span className="kv__k">温度</span>
                <span className="kv__v">{params.temperature ?? '未设置'}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Top P</span>
                <span className="kv__v">{params.topP ?? '未设置'}</span>
              </div>
              <div className="kv">
                <span className="kv__k">最大长度</span>
                <span className="kv__v">{params.maxTokens ?? '未设置'}</span>
              </div>
              <div className="kv">
                <span className="kv__k">Token</span>
                <span className="kv__v">未统计</span>
              </div>
            </div>
          </>
        ) : null}

        {tab === 'tools' ? (
          <>
            <div className="insp__group">
              <span className="insp__label">本轮 Agent 调用</span>
              {details.length === 0 ? (
                <p className="insp__empty">
                  还没有工具调用记录。普通对话不会走工具；点输入框里的「🧭 计划」跑一次 Agent
                  才会产生。
                </p>
              ) : (
                details.map((detail) => (
                  <div
                    key={detail.id}
                    className={`insp__row${detail.status === 'failed' ? ' insp__row--failed' : ''}`}
                  >
                    <div className="insp__row-head">
                      <span className="insp__row-title">{detail.tool ?? '未使用工具'}</span>
                      <span className="insp__row-meta">{formatMs(detail.durationMs)}</span>
                    </div>
                    <span className="insp__row-meta">
                      {STATUS_LABEL[detail.status] ?? detail.status}
                      {detail.code ? ` · ${detail.code}` : ''}
                    </span>
                  </div>
                ))
              )}
            </div>

            <div className="insp__group">
              <span className="insp__label">已连接的 MCP 服务</span>
              {mcpConnections.length === 0 ? (
                <p className="insp__empty">没有连接外部服务。接入入口在设置里（HTTP 传输）。</p>
              ) : (
                mcpConnections.map((connection) => (
                  <div key={connection.serverName} className="insp__row">
                    <div className="insp__row-head">
                      <span className="insp__row-title">{connection.serverName}</span>
                    </div>
                    <span className="insp__row-meta">{connection.url}</span>
                  </div>
                ))
              )}
            </div>
          </>
        ) : null}

        {tab === 'run' ? (
          <>
            <div className="insp__group">
              <span className="insp__label">最近一次对话</span>
              <div className="kv">
                <span className="kv__k">耗时</span>
                <span className="kv__v">{formatMs(lastRunMs)}</span>
              </div>
              <div className="kv">
                <span className="kv__k">首字延迟</span>
                <span className="kv__v">未统计</span>
              </div>
            </div>

            <div className="insp__group">
              <span className="insp__label">Agent 运行</span>
              {planRun?.plan ? (
                <>
                  <div className="kv">
                    <span className="kv__k">状态</span>
                    <span className="kv__v">
                      {planRun.status === 'running'
                        ? '执行中'
                        : planRun.status === 'completed'
                          ? '已完成'
                          : planRun.status === 'failed'
                            ? '失败'
                            : planRun.status === 'stopped'
                              ? '等待确认'
                              : '空闲'}
                    </span>
                  </div>
                  <div className="kv">
                    <span className="kv__k">进度</span>
                    <span className="kv__v">
                      {planRun.plan.progress.success}/{planRun.plan.progress.total}
                    </span>
                  </div>
                  {steps.map((step) => (
                    <div
                      key={step.id}
                      className={`insp__row${step.status === 'failed' ? ' insp__row--failed' : ''}`}
                    >
                      <div className="insp__row-head">
                        <span className="insp__row-title">{step.action}</span>
                        <span className="insp__row-meta">
                          {STATUS_LABEL[step.status] ?? step.status}
                        </span>
                      </div>
                      <span className="insp__row-meta">
                        {step.tool ?? '无工具'} · 风险 {step.risk}
                        {step.requiresConfirmation ? ' · 需确认' : ''}
                      </span>
                    </div>
                  ))}
                </>
              ) : (
                <p className="insp__empty">
                  没有正在运行的 Agent 任务。输入目标后点「🧭 计划」生成步骤，执行过程会显示在这里和右侧面板。
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </aside>
  )
}
