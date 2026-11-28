// lib/assistantDefaults —— 内置「通用助手」在渲染层的兜底行。
//
// 主进程启动收编会确保它存在；但收编失败（assistants.json 损坏 / 写盘失败）时
// 列表里就没有它，于是「它的专题」里的会话没有 Agent 行可挂，侧栏整块消失。
// 这里合成一条最小 DTO 兜底：分桶、置顶、筛选、boundAssistant 都吃同一份数据。
import type { AssistantDto } from '../../../shared/types/ipc.ts'
import { DEFAULT_ASSISTANT_ID } from '../../../shared/types/ipc.ts'

export const BUILTIN_ASSISTANT_NAME = '通用助手'

function syntheticBuiltin(now: string): AssistantDto {
  return {
    id: DEFAULT_ASSISTANT_ID,
    name: BUILTIN_ASSISTANT_NAME,
    systemPrompt: '',
    providerId: null,
    modelId: null,
    params: { temperature: 0.7, maxTokens: 2048, topP: 1 },
    enabled: true,
    permissionMode: 'smart',
    avatar: null,
    builtin: true,
    createdAt: now,
    updatedAt: now
  }
}

/**
 * 保证列表里有内置通用助手：缺就补一条，有就原样返回（不重复、不改用户那条）。
 */
export function withBuiltinAssistant(
  assistants: readonly AssistantDto[],
  now: string
): AssistantDto[] {
  if (assistants.some((assistant) => assistant.id === DEFAULT_ASSISTANT_ID)) {
    return [...assistants]
  }
  return [syntheticBuiltin(now), ...assistants]
}
