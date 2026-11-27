// lib/permissionModes —— 五档权限模式的展示文案与告警色。
//
// 只放展示元数据；真正的执行语义在 main 的 assistant 契约与 planConfirm 里。
import {
  AGENT_PERMISSION_MODES,
  type AgentPermissionMode
} from '../../../shared/types/ipc.ts'

export type PermissionTone = 'neutral' | 'warn' | 'danger'

export interface PermissionModeMeta {
  label: string
  description: string
  tone: PermissionTone
}

export const PERMISSION_MODE_ORDER: readonly AgentPermissionMode[] = AGENT_PERMISSION_MODES

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
    description: '可自由编辑文件，执行命令前询问。',
    tone: 'neutral'
  },
  smart: {
    label: '智能批准',
    description: '无需逐次批准，安全检查会拦截风险操作。',
    tone: 'warn'
  },
  'full-access': {
    label: '完全访问',
    description: '跳过权限检查，可删除文件、访问网络。',
    tone: 'danger'
  }
}

export function permissionModeMeta(mode?: string | null): PermissionModeMeta {
  if (mode && Object.hasOwn(PERMISSION_MODE_META, mode)) {
    return PERMISSION_MODE_META[mode as AgentPermissionMode]
  }
  return PERMISSION_MODE_META.smart
}
