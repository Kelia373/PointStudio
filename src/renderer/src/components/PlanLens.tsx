// 计划透镜：Agent 跑多步计划时，在消息流里给一条可原地展开的折叠条。
//
// 为什么不是抽屉：抽屉会盖住右侧检查器，而用户恰恰要在计划跑的时候看检查器。
// 折叠态只占一行（目标 + 进度 + 耗时），点开就地列出每步的工具、耗时与错误码。
import { useState } from 'react'

import { planLensView } from '../lib/planLens'
import type { PlanRunState } from '../lib/planRunState'
import Icon from './Icon'

export default function PlanLens({
  run,
  elapsedMs,
  onConfirm
}: {
  run: PlanRunState | null
  /** 这一轮的耗时（毫秒）；未知就不显示。 */
  elapsedMs?: number | null
  /** stopped 时「确认并继续」：带上已确认的高风险步骤重跑。 */
  onConfirm: () => void
}) {
  const [open, setOpen] = useState(false)
  const view = planLensView(run, { elapsedMs })
  if (!view) {
    return null
  }

  return (
    <div className="plan-lens">
      <div className="plan-lens__bar">
        <button
          className="plan-lens__main"
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name="compass" size={13} />
          <span className="plan-lens__goal">{view.goal}</span>
          <span className="plan-lens__meta">
            {view.done}/{view.total} 步{view.elapsed === '' ? '' : ` · ${view.elapsed}`}
          </span>
          <span className="plan-lens__toggle">{open ? '收起步骤 ▴' : '展开步骤 ▾'}</span>
        </button>
        {view.needsConfirm ? (
          <button className="plan-lens__confirm" type="button" onClick={onConfirm}>
            确认并继续
          </button>
        ) : null}
      </div>

      {open ? (
        <ol className="plan-lens__steps">
          {view.steps.map((step) => (
            <li key={step.id} className={`plan-lens__step plan-lens__step--${step.status}`}>
              <span className="plan-lens__action">{step.action}</span>
              {step.tool ? <span className="plan-lens__tool">{step.tool}</span> : null}
              {step.duration ? <span className="plan-lens__dur">{step.duration}</span> : null}
              {step.code ? <span className="plan-lens__code">{step.code}</span> : null}
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}
