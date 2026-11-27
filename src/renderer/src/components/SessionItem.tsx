// 侧栏单条会话。抽出来是为了让它可被插件覆盖（sidebar.sessionItem）。
import type { ConversationDto } from '../../../shared/types/ipc.ts'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

export interface SessionItemProps {
  conversation: ConversationDto
  active: boolean
  onSelect: () => void
  onRemove: () => void
}

export default function SessionItem({ conversation, active, onSelect, onRemove }: SessionItemProps) {
  return (
    <div className={`side__item${active ? ' side__item--active' : ''}`}>
      <button
        className="side__item-main"
        type="button"
        onClick={onSelect}
        title={conversation.title}
      >
        {conversation.title}
      </button>
      <ConfirmButton
        className="side__item-remove"
        ariaLabel="删除会话"
        title="删除会话"
        confirmLabel="删?"
        onConfirm={onRemove}
      >
        <Icon name="x" size={12} />
      </ConfirmButton>
    </div>
  )
}
