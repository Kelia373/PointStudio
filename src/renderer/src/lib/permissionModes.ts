// lib/permissionModes —— 五档权限模式的展示文案与告警色。
//
// 只放展示元数据；真正的执行语义在 main 的 assistant 契约与 planConfirm 里。
import type { AgentPermissionMode } from '../../../shared/types/ipc.ts'

export type PermissionTone = 'neutral' | 'warn' | 'danger'

export interface PermissionModeMeta {
  label: string
  description: string
  tone: PermissionTone
}

export const PERMISSION_MODE_ORDER: readonly AgentPermissionMode[] = [
  'auto-edit',
  'smart',
  'full-access'
]

export const PERMISSION_MODE_META: Record<AgentPermissionMode, PermissionModeMeta> = {
  ask: {
    label: '逐次确认',
    description: '编辑文件或执行命令前询问。',
    tone: 'neutral'
  },
  'plan-only': {
    label: '仅规划',
    description: '只规划、不编辑文件，仅执行只读或审查通过的命令。',
    tone: 'neutral'
  },
  'auto-edit': {
    label: '自动接受编辑',
    description: '自动读写文件，执行命令前询问',
    tone: 'neutral'
  },
  smart: {
    label: '智能批准',
    description: '自动放行常规操作，拦截高风险',
    tone: 'warn'
  },
  'full-access': {
    label: '完全访问',
    description: '跳过所有权限检查，高危全放行',
    tone: 'danger'
  }
}

/** 历史 Agent 可能还是 ask / plan-only：UI 只展示三档，回退到 smart。 */
export function uiPermissionMode(mode?: string | null): AgentPermissionMode {
  if (mode && (PERMISSION_MODE_ORDER as readonly string[]).includes(mode)) {
    return mode as AgentPermissionMode
  }
  return 'smart'
}

export function permissionModeMeta(mode?: string | null): PermissionModeMeta {
  if (mode && Object.hasOwn(PERMISSION_MODE_META, mode)) {
    return PERMISSION_MODE_META[mode as AgentPermissionMode]
  }
  return PERMISSION_MODE_META.smart
}
