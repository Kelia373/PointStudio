// 侧栏单条会话。抽出来是为了让它可被插件覆盖（sidebar.sessionItem）。
import { useState } from 'react'

import { describeError } from '../../../shared/i18n/errors.ts'
import type { ConversationDto } from '../../../shared/types/ipc.ts'
import ConfirmButton from './ConfirmButton'
import Icon from './Icon'

export interface SessionItemProps {
  conversation: ConversationDto
  active: boolean
  onSelect: () => void
  onRemove: () => void
  /** 行内重命名；返回错误码，null 表示成功。双击或右键标题进入编辑。 */
  onRename?: (title: string) => Promise<string | null>
}

export default function SessionItem({
  conversation,
  active,
  onSelect,
  onRemove,
  onRename
}: SessionItemProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(conversation.title)
  const [error, setError] = useState<string | null>(null)

  async function commit(): Promise<void> {
    if (!onRename) {
      setEditing(false)
      return
    }
    const title = value.trim()
    if (title === '') {
      setError('标题不能为空')
      return
    }
    if (title === conversation.title) {
      setEditing(false)
      setError(null)
      return
    }
    const code = await onRename(title)
    if (code !== null) {
      setError(describeError(code))
      return
    }
    setEditing(false)
    setError(null)
  }

  function cancel(): void {
    setValue(conversation.title)
    setError(null)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="side__item side__item--editing">
        <input
          className={`side__item-input${error ? ' side__item-input--bad' : ''}`}
          value={value}
          autoFocus
          aria-label="重命名会话"
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void commit()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
          onBlur={() => void commit()}
        />
        {error ? <span className="side__item-hint">{error}</span> : null}
      </div>
    )
  }

  return (
    <div className={`side__item${active ? ' side__item--active' : ''}`}>
      <button
        className="side__item-main"
        type="button"
        onClick={onSelect}
        onDoubleClick={() => {
          if (!onRename) {
            return
          }
          setValue(conversation.title)
          setEditing(true)
        }}
        onContextMenu={(event) => {
          if (!onRename) {
            return
          }
          event.preventDefault()
          setValue(conversation.title)
          setEditing(true)
        }}
        title={onRename ? `${conversation.title}（双击或右键重命名）` : conversation.title}
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
