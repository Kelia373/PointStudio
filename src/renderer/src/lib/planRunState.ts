// renderer/lib/planRunState —— Agent 事件到计划面板状态的归约。
//
// 此前这段判断埋在组件的事件回调里（三层嵌套条件），没有 jsdom 就测不了。
// 抽成纯函数后：事件 → 新状态，组件只负责把结果交给 React。
import type { AgentEventDto, AgentStepDetailDto, PlanViewDto } from '../../../shared/types/ipc.ts'

export type PlanRunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped'

export interface PlanRunState {
  id: string
  plan: PlanViewDto | null
  status: PlanRunStatus
  details?: AgentStepDetailDto[]
  /**
   * 发起这次计划的会话 id。
   * 计划是全局唯一的一条，但灯必须亮在「真正发起它」的 Agent 上，
   * 不能因为用户切到别的会话就把别人点亮。
   */
  sessionId?: string | null
}

/**
 * 归约一条 Agent 事件。
 *
 * - 没有在跑的任务时忽略事件（返回原值），避免迟到的推送污染界面；
 * - `error` 只把状态改成 failed，**不清空已显示的计划**——用户需要看到它卡在哪；
 * - 一律返回新对象，不修改入参（React 靠引用变化重渲染）。
 */
export function reduceAgentEvent(
  current: PlanRunState | null,
  event: AgentEventDto
): PlanRunState | null {
  if (!current) {
    return current
  }

  switch (event.type) {
    case 'plan':
    case 'step':
      return { ...current, plan: event.plan, status: 'running' }
    case 'done':
      return {
        ...current,
        plan: event.plan,
        status: event.status,
        details: event.details
      }
    case 'error':
      return { ...current, status: 'failed' }
    case 'replan':
      return { ...current, status: 'running' }
    default:
      return current
  }
}
