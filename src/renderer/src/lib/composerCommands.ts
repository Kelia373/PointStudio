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
