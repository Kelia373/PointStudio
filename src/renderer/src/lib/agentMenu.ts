// lib/agentMenu —— Agent 右键菜单的六项动作。
//
// 菜单是数据不是 JSX：顺序、文案、哪一项当前可点，都写在这里，
// 组件只负责把它画出来并把点击翻译成回调。

export type AgentMenuAction =
  | 'rename'
  | 'settings'
  | 'copy'
  | 'paste'
  | 'toggle-enabled'
  | 'remove'

export interface AgentMenuItem {
  action: AgentMenuAction
  label: string
  /** 置灰但仍占位：用户要看得见这个能力，只是现在用不了。 */
  disabled?: boolean
}

export interface AgentMenuInput {
  /** 这个 Agent 当前是否启用。 */
  enabled: boolean
  /** 应用内剪贴板里有没有可粘贴的 Agent。 */
  canPaste: boolean
  /** 内置通用助手：可改名换模型，但不能停用、不能删。 */
  builtin?: boolean
}

export function buildAgentMenuItems(input: AgentMenuInput): AgentMenuItem[] {
  return [
    { action: 'rename', label: '重命名' },
    { action: 'settings', label: '智能体设置' },
    { action: 'copy', label: '复制智能体' },
    { action: 'paste', label: '粘贴智能体', disabled: !input.canPaste },
    {
      action: 'toggle-enabled',
      label: input.builtin === true ? '系统内置，不可停用' : input.enabled ? '标记为停用' : '标记为启用',
      // 置灰而不是隐藏：让用户看得见这是被系统保护的能力。
      ...(input.builtin === true ? { disabled: true } : {})
    },
    {
      action: 'remove',
      label: input.builtin === true ? '系统内置，不可删除' : '删除智能体',
      ...(input.builtin === true ? { disabled: true } : {})
    }
  ]
}
