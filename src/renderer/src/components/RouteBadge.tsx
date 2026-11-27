// 路由徽章：这一轮由谁决定、判了多难、用了哪个模型、把握多大。
import { useState } from 'react'

import { formatRouteTick, type DifficultyCategory, type DifficultyLevel } from '../lib/pandaRouter'
import type { RouteDecisionDto } from '../../../shared/types/ipc.ts'

export default function RouteBadge({ decision }: { decision: RouteDecisionDto | null }) {
  const [open, setOpen] = useState(false)

  if (!decision) {
    return null
  }

  const tick = formatRouteTick({
    level: decision.difficulty.level as DifficultyLevel,
    category: decision.difficulty.category as DifficultyCategory,
    model: decision.chosenModel,
    confidence: decision.confidence
  })

  return (
    <span className="route-badge">
      <button
        className="route-badge__chip"
        type="button"
        aria-expanded={open}
        title="查看本次路由决策"
        onClick={() => setOpen((value) => !value)}
      >
        {tick}
      </button>

      {open ? (
        <>
          <span className="route-badge__mask" role="presentation" onClick={() => setOpen(false)} />
          <div className="route-badge__pop" role="dialog" aria-label="路由决策">
            <div className="route-badge__row">
              <span>决定者</span>
              <b>{decision.decidedBy}</b>
            </div>
            {decision.attempt !== undefined ? (
              <div className="route-badge__row">
                <span>尝试</span>
                <b>第 {decision.attempt + 1} 次</b>
              </div>
            ) : null}
            {decision.escalatedFrom ? (
              <div className="route-badge__row">
                <span>升级自</span>
                <b>{decision.escalatedFrom}</b>
              </div>
            ) : null}
            {decision.escalationLadder && decision.escalationLadder.length > 0 ? (
              <ol className="route-badge__ladder">
                {decision.escalationLadder.map((step) => (
                  <li key={step.model}>
                    <span>{step.model}</span>
                    <em>{Math.round(step.pSuccess * 100)}%</em>
                    {step.estCostUsd !== undefined ? <em>${step.estCostUsd}</em> : null}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        </>
      ) : null}
    </span>
  )
}
