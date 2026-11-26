// lib/planLens —— 计划透镜的视图模型。
//
// 多步计划不该弹一个遮罩抽屉把右侧检查器挡住；正确做法是在消息流里给一条
// 折叠条：默认一行（目标 + 进度 + 耗时），点开原地列出每步的工具与耗时。
// 这里只负责把 PlanRunState 摊平成组件能直接渲染的数据。
import type { AgentStepDetailDto, PlanViewDto } from '../../../shared/types/ipc.ts'
import type { PlanRunState } from './planRunState'

export interface PlanLensStep {
  id: string
  action: string
  tool: string | null
  /** 已格式化；未知为空串。 */
  duration: string
  code: string | null
  status: string
}

export interface PlanLensView {
  goal: string
  /** 已结束的步数（成功 + 失败 + 跳过）。 */
  done: number
  total: number
  elapsed: string
  /** stopped：等用户确认后继续。 */
  needsConfirm: boolean
  steps: PlanLensStep[]
}

/** 耗时文案：不足 1 秒用毫秒，超了留一位小数，未知留空。 */
export function formatElapsed(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) {
    return ''
  }
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function detailOf(details: AgentStepDetailDto[] | undefined, id: string): AgentStepDetailDto | null {
  if (!details) {
    return null
  }
  return details.find((detail) => detail.id === id) ?? null
}

/**
 * 摊平一个计划运行状态；没有计划可看时返回 null（组件据此不渲染）。
 * 步骤的工具 / 耗时 / 错误码以执行详情为准——计划里的 tool 只是预声明。
 */
export function planLensView(
  run: PlanRunState | null,
  options: { elapsedMs?: number | null } = {}
): PlanLensView | null {
  if (!run || !run.plan) {
    return null
  }
  const plan: PlanViewDto = run.plan
  const progress = plan.progress

  return {
    goal: plan.goal,
    done: progress.success + progress.failed + progress.skipped,
    total: progress.total,
    elapsed: formatElapsed(options.elapsedMs),
    needsConfirm: run.status === 'stopped',
    steps: plan.steps.map((step) => {
      const detail = detailOf(run.details, step.id)
      return {
        id: step.id,
        action: step.action,
        tool: detail?.tool ?? step.tool,
        duration: formatElapsed(detail?.durationMs),
        code: detail?.code ?? null,
        status: detail?.status ?? step.status
      }
    })
  }
}
