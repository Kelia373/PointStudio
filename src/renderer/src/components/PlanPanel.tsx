// 计划面板：显示「它打算怎么做、走到哪一步」。
//
// 只显示主进程推来的视图，不在界面里推断进度——进度只有执行器知道。
import { describeError } from '../../../shared/i18n/errors.ts'
import type { AgentStepDetailDto, PlanViewDto } from '../../../shared/types/ipc.ts'

function detailOf(id: string, details?: AgentStepDetailDto[]): AgentStepDetailDto | undefined {
  return details?.find((item) => item.id === id)
}

function detilCode(id: string, details?: AgentStepDetailDto[]): string {
  return describeError(detailOf(id, details)?.code ?? '')
}

const STATUS_LABEL: Record<PlanViewDto['steps'][number]['status'], string> = {
  pending: '待执行',
  running: '执行中',
  success: '完成',
  failed: '失败',
  skipped: '跳过'
}

export default function PlanPanel({
  plan,
  status,
  details,
  onClose,
  onConfirm
}: {
  plan: PlanViewDto
  status: 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  details?: AgentStepDetailDto[]
  onClose: () => void
  /** 停止时提供：带着确认结果重跑。 */
  onConfirm?: () => void
}) {
  const { progress } = plan

  return (
    <div className="plan">
      <div className="plan__head">
        <span className="plan__goal" title={plan.goal}>
          {plan.goal}
        </span>
        <span className="plan__progress">
          {progress.success}/{progress.total}
          {progress.failed > 0 ? ` · ${progress.failed} 失败` : ''}
        </span>
        <button className="plan__close" type="button" onClick={onClose}>
          收起
        </button>
      </div>

      <ol className="plan__steps">
        {plan.steps.map((step) => (
          <li key={step.id} className={`plan__step plan__step--${step.status}`}>
            <span className="plan__status">{STATUS_LABEL[step.status]}</span>
            <span className="plan__action">{step.action}</span>
            {step.tool ? <span className="plan__tool">{step.tool}</span> : null}
            {step.requiresConfirmation ? (
              <span className="plan__needs">需要确认</span>
            ) : null}
            {detailOf(step.id, details)?.durationMs !== undefined ? (
              <span className="plan__detail">{detailOf(step.id, details)?.durationMs}ms</span>
            ) : null}
            {detailOf(step.id, details)?.code ? (
              <span className="plan__detail plan__detail--error">
                {detilCode(step.id, details)}
              </span>
            ) : null}
          </li>
        ))}
      </ol>

      {plan.stopConditions.length > 0 ? (
        <div className="plan__stops">停止条件：{plan.stopConditions.join('；')}</div>
      ) : null}

      {status === 'stopped' ? (
        <div className="plan__note">
          有高风险步骤未确认，计划已暂停。
          {onConfirm ? (
            <button className="plan__confirm" type="button" onClick={onConfirm}>
              确认并继续
            </button>
          ) : null}
        </div>
      ) : null}
      {status === 'failed' ? <div className="plan__note">执行失败，详见上方失败步骤。</div> : null}
    </div>
  )
}
