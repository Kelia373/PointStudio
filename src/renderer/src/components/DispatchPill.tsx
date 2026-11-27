// 顶栏「派遣胶囊」：左边是 Agent，右边是项目，两个维度用细竖线隔开。
// 左半区点开换人 = 同一会话中途接力；右半区打开工作区面板。
//
// 「模式」（真模型 / 未发送）不在这里：顶栏右侧那枚带呼吸灯圆点的状态胶囊
// 才是唯一出处，两处都显示就是冗余。
import { useState } from 'react'

import { LIGHT_LABEL, type AgentLightState } from '../lib/dispatchFilter'
import AgentAvatar from './AgentAvatar'
import Icon from './Icon'

export interface DispatchAgent {
  id: string
  name: string
  /** 驻场指示灯：与侧栏 Agent Bench 同一套判定。 */
  state: AgentLightState
}

export interface DispatchPillProps {
  agentName: string | null
  /** 当前绑定 Agent 的状态；未绑定时为 null，不画灯。 */
  agentState: AgentLightState | null
  /** 当前绑定 Agent 的手选头像；null 走自动匹配。 */
  agentAvatar?: string | null
  projectName: string | null
  agents: DispatchAgent[]
  activeAgentId: string | null
  onPickAgent: (agentId: string | null) => void
  onOpenProject: () => void
}

export default function DispatchPill({
  agentName,
  agentState,
  agentAvatar = null,
  projectName,
  agents,
  activeAgentId,
  onPickAgent,
  onOpenProject
}: DispatchPillProps) {
  const [open, setOpen] = useState(false)

  return (
    <span className="dispatch-pill">
      <button
        className="dispatch-pill__seg"
        type="button"
        aria-expanded={open}
        aria-label="切换当前会话的 Agent"
        title="换一位 Agent 接手这个会话"
        onClick={() => setOpen((value) => !value)}
      >
        {agentName ? (
          <AgentAvatar
            agentId={activeAgentId ?? ''}
            name={agentName}
            avatar={agentAvatar}
            size={14}
          />
        ) : (
          <Icon name="user" size={13} />
        )}
        {agentState ? (          <span
            className={`dispatch-pill__status dispatch-pill__status--${agentState}`}
            aria-label={LIGHT_LABEL[agentState]}
            title={LIGHT_LABEL[agentState]}
          />
        ) : null}
        <span className="dispatch-pill__text">{agentName ?? '未派 Agent'}</span>
      </button>

      <button
        className="dispatch-pill__seg"
        type="button"
        aria-label="切换项目"
        title="查看 / 切换项目"
        onClick={onOpenProject}
      >
        <Icon name="folder" size={13} />
        <span className="dispatch-pill__text">{projectName ?? '临时会话'}</span>
      </button>

      {open ? (
        <>
          <span className="dispatch-pill__mask" role="presentation" onClick={() => setOpen(false)} />
          <div className="dispatch-pill__pop" role="listbox" aria-label="选择 Agent">
            <button
              className={`dispatch-pill__item${activeAgentId === null ? ' is-active' : ''}`}
              type="button"
              onClick={() => {
                onPickAgent(null)
                setOpen(false)
              }}
            >
              不使用 Agent（默认对话）
            </button>
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`dispatch-pill__item${agent.id === activeAgentId ? ' is-active' : ''}`}
                type="button"
                onClick={() => {
                  onPickAgent(agent.id)
                  setOpen(false)
                }}
              >
                <span
                  className={`dispatch-pill__status dispatch-pill__status--${agent.state}`}
                  aria-label={LIGHT_LABEL[agent.state]}
                  title={LIGHT_LABEL[agent.state]}
                />
                {agent.name}
              </button>
            ))}
            {agents.length === 0 ? <span className="dispatch-pill__empty">还没有 Agent</span> : null}
          </div>
        </>
      ) : null}
    </span>
  )
}
