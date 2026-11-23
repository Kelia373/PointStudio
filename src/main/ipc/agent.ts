// ipc/agent —— 目标推进的跨进程边界。
//
// 一次「跑一个目标」会经历：生成计划 → 执行 → 失败重规划 → 再执行。
// 过程用事件推给界面（plan / step / replan / done），界面据此显示，
// 不需要轮询、也不需要猜当前在哪一步。
import { ipcMain } from 'electron'

import {
  AGENT_CHANNELS,
  type AgentEventDto,
  type AgentRunRequest,
  type IpcResult,
  type PlanViewDto
} from '../../shared/types/ipc.ts'
import { executePlan } from '../ai/agent/executor.ts'
import type { Plan } from '../ai/agent/plan.ts'
import type { ToolRegistry } from '../ai/tools/registry.ts'
import { runGoal } from '../services/agentLoop.ts'
import { toPlanView } from '../services/agentRunService.ts'
import type { ChatEngineDeps } from '../services/chatEngine.ts'
import { generatePlan, replanAfterFailure } from '../services/planService.ts'

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface AgentIpcOptions {
  engine: ChatEngineDeps
  tools: ToolRegistry
  /** 最多重规划几次。 */
  maxReplans?: number
}

function toDto(plan: Plan): PlanViewDto {
  return toPlanView(plan)
}

export function registerAgentIpc(options: AgentIpcOptions): void {
  ipcMain.handle(
    AGENT_CHANNELS.run,
    async (event, request: unknown): Promise<IpcResult<true>> => {
      if (typeof request !== 'object' || request === null) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const { id, goal, confirmedStepIds } = request as Partial<AgentRunRequest>
      if (
        typeof id !== 'string' ||
        !ID_PATTERN.test(id) ||
        typeof goal !== 'string' ||
        goal.trim() === '' ||
        (confirmedStepIds !== undefined &&
          (!Array.isArray(confirmedStepIds) || confirmedStepIds.some((item) => typeof item !== 'string')))
      ) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }

      const emit = (payload: AgentEventDto): void => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(AGENT_CHANNELS.event, payload)
        }
      }

      // 后台跑，立刻返回——过程靠事件推。
      void (async () => {
        try {
          const result = await runGoal(goal, {
            generate: (target) =>
              generatePlan(target, { engine: options.engine, tools: options.tools, now: () => new Date().toISOString() }),
            execute: (plan, execOptions) =>
              executePlan(plan, {
                tools: options.tools,
                confirmedStepIds: execOptions.confirmedStepIds,
                onStepChange: (current) => emit({ type: 'step', plan: toDto(current) })
              }),
            replan: (request_) =>
              replanAfterFailure(request_, {
                engine: options.engine,
                tools: options.tools,
                now: () => new Date().toISOString()
              }),
            maxReplans: options.maxReplans ?? 1,
            confirmedStepIds,
            onPlan: (plan) => emit({ type: 'plan', plan: toDto(plan) }),
            onReplan: (request_) =>
              emit({ type: 'replan', failedStepId: request_.failedStepId, errorCode: request_.errorCode })
          })

          emit({
            type: 'done',
            status: result.status,
            plan: toDto(result.plan),
            ...(result.reason ? { reason: result.reason } : {})
          })
        } catch (error) {
          console.error('[agent] 目标推进失败', error)
          emit({ type: 'error', code: 'E_INTERNAL' })
        }
      })()

      return { ok: true, value: true }
    }
  )
}
