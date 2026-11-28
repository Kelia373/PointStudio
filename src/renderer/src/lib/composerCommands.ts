// lib/composerCommands —— 输入栏斜杠指令的解析（纯函数，便于单测）。
//
// 关键约定：裸 `/plan` 绝不能当成目标发起规划，只能提示补目标；
// 只有 `/plan <目标>` 才真的进入规划。
export type SlashCommand =
  | { kind: 'plan'; goal: string }
  | { kind: 'plan-needs-goal' }
  | { kind: 'stop' }
  | { kind: 'clear' }
  | null

export function parseSlashCommand(value: string): SlashCommand {
  const match = value.match(/^\/(plan|stop|clear)(?:\s+([\s\S]*))?$/)
  if (!match) {
    return null
  }
  const command = match[1]
  const payload = (match[2] ?? '').trim()
  if (command === 'plan') {
    return payload === '' ? { kind: 'plan-needs-goal' } : { kind: 'plan', goal: payload }
  }
  if (command === 'stop') {
    return { kind: 'stop' }
  }
  return { kind: 'clear' }
}


export type ComposerAction =
  | { type: 'stop' }
  | { type: 'clear' }
  | { type: 'plan'; goal: string }
  | { type: 'plan-needs-goal' }
  | { type: 'send' }
  | { type: 'blocked' }

/**
 * 按当前忙碌状态决定这次 Enter / 发送该做什么。
 * /stop 与 /clear 在生成中也必须可用；其余动作在 busy 时拦截。
 */
export function resolveComposerAction(value: string, busy: boolean): ComposerAction {
  const command = parseSlashCommand(value)
  if (command === null) {
    return busy ? { type: 'blocked' } : { type: 'send' }
  }
  if (command.kind === 'stop') {
    return { type: 'stop' }
  }
  if (command.kind === 'clear') {
    return { type: 'clear' }
  }
  if (command.kind === 'plan-needs-goal') {
    return { type: 'plan-needs-goal' }
  }
  return busy ? { type: 'blocked' } : { type: 'plan', goal: command.goal }
}
