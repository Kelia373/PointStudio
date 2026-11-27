// 主群里的「交接瘦胶囊」：一行说完谁交给谁、在做什么、什么状态。
// 完整施工单不在这里展开——点「右屏盯盘」投到副画布看。
import type { HandoffEnvelopeDto } from '../../../shared/types/ipc.ts'
import Icon from './Icon'

const KIND_LABEL: Record<HandoffEnvelopeDto['kind'], string> = {
  handoff: '交接',
  question: '提问',
  subagent_spawn: '派生',
  receipt: '收据'
}

const STATUS_LABEL: Record<HandoffEnvelopeDto['status'], string> = {
  pending: '待接手',
  accepted: '已接手',
  running: '执行中',
  done: '完成',
  failed: '失败'
}

export default function HandoffPill({
  handoff,
  fromName,
  toName,
  onOpenInSplit
}: {
  handoff: HandoffEnvelopeDto
  fromName: string
  toName: string
  onOpenInSplit?: () => void
}) {
  return (
    <article className="handoff" title={handoff.summary}>
      <span className="handoff__kind">{KIND_LABEL[handoff.kind]}</span>
      <span className="handoff__flow">
        <b>{fromName}</b>
        <span className="handoff__arrow">→</span>
        <b>{toName}</b>
      </span>
      <span className="handoff__summary">{handoff.summary}</span>
      <span className={`handoff__status handoff__status--${handoff.status}`}>
        {STATUS_LABEL[handoff.status]}
      </span>
      <button
        className="handoff__act"
        type="button"
        disabled={!onOpenInSplit}
        onClick={onOpenInSplit}
        title="在右侧分屏查看完整交接单与任务链"
      >
        <Icon name="square-arrow-right" size={12} />
        右屏盯盘
      </button>
    </article>
  )
}
