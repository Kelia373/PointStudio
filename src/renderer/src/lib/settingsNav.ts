// lib/settingsNav —— 全局设置的一级分组与二级模块元数据（纯数据 + 纯查询）。
export type SettingsGroupId =
  | 'ai-agent'
  | 'basic'
  | 'workflow'
  | 'interface'
  | 'experimental'
  | 'privacy-security'

export type SettingsSectionId =
  | 'default-models'
  | 'model-services'
  | 'local-models'
  | 'routing'
  | 'mcp'
  | 'skills'
  | 'memory-rag'
  | 'usage'
  | 'general'
  | 'shortcuts'
  | 'proxy'
  | 'about'
  | 'git'
  | 'automation'
  | 'terminal'
  | 'browser'
  | 'appearance'
  | 'typography'
  | 'notifications'
  | 'plugins'
  | 'feature-flags'
  | 'security-guardrails'
  | 'credentials'
  | 'data-backup'

export interface SettingsSectionMeta {
  id: SettingsSectionId
  groupId: SettingsGroupId
  label: string
  description: string
}

export interface SettingsGroupMeta {
  id: SettingsGroupId
  order: number
  label: string
  sections: SettingsSectionMeta[]
}

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = 'model-services'

function section(
  groupId: SettingsGroupId,
  id: SettingsSectionId,
  label: string,
  description: string
): SettingsSectionMeta {
  return { id, groupId, label, description }
}

export const SETTINGS_GROUPS: readonly SettingsGroupMeta[] = [
  {
    id: 'ai-agent',
    order: 1,
    label: 'AI Agent',
    sections: [
      section('ai-agent', 'default-models', '默认模型', '主对话 / 快反 / 规划 / 向量四个槽位'),
      section('ai-agent', 'model-services', '模型服务', '直连 API 与 CLI 智能体引擎双轨接入'),
      section('ai-agent', 'local-models', '本地模型', 'Ollama 与 LM Studio 本地运行时'),
      section('ai-agent', 'routing', '路由编排', '协同路由与升级阶梯'),
      section('ai-agent', 'mcp', 'MCP', '外部工具服务连接'),
      section('ai-agent', 'skills', 'Skills', '可复用的 Agent 技能'),
      section('ai-agent', 'memory-rag', '记忆与知识库', '私域记忆与检索增强'),
      section('ai-agent', 'usage', '用量', 'Token 与调用统计')
    ]
  },
  {
    id: 'basic',
    order: 2,
    label: '基本设置',
    sections: [
      section('basic', 'general', '通用设置', '启动行为、语言与更新'),
      section('basic', 'shortcuts', '快捷键', '全局键位绑定'),
      section('basic', 'proxy', '代理', '网络代理与证书'),
      section('basic', 'about', '关于 PointStudio', '版本、许可与第三方声明')
    ]
  },
  {
    id: 'workflow',
    order: 3,
    label: '工作流程',
    sections: [
      section('workflow', 'git', 'Git 和源代码控制', '提交、分支与差异查看'),
      section('workflow', 'automation', '自动化', '定时任务与触发器'),
      section('workflow', 'terminal', '终端', '默认 Shell 与启动目录'),
      section('workflow', 'browser', '浏览器', 'Agent 浏览器四层工作流')
    ]
  },
  {
    id: 'interface',
    order: 4,
    label: '界面',
    sections: [
      section('interface', 'appearance', '外观与颜色', '主题、密度与动效'),
      section('interface', 'typography', '字体与字号', '正文、等宽与字号阶梯'),
      section('interface', 'notifications', '通知', '系统通知与提示音')
    ]
  },
  {
    id: 'experimental',
    order: 5,
    label: '实验性',
    sections: [
      section('experimental', 'plugins', '插件', '插件注册表与隔离'),
      section('experimental', 'feature-flags', '实验特性开关', '未完成的实验能力')
    ]
  },
  {
    id: 'privacy-security',
    order: 6,
    label: '隐私和安全',
    sections: [
      section('privacy-security', 'security-guardrails', '全局权限护栏', '默认权限模式与高危拦截'),
      section('privacy-security', 'credentials', '凭据管理', 'API Key 与 CLI 凭据'),
      section('privacy-security', 'data-backup', '数据与备份', '导出、合并导入与恢复')
    ]
  }
]

const SECTION_INDEX = new Map<SettingsSectionId, SettingsSectionMeta>()
for (const group of SETTINGS_GROUPS) {
  for (const item of group.sections) {
    SECTION_INDEX.set(item.id, item)
  }
}

export function findSettingsSection(id: string | null | undefined): SettingsSectionMeta {
  const found = id ? SECTION_INDEX.get(id as SettingsSectionId) : undefined
  return found ?? SECTION_INDEX.get(DEFAULT_SETTINGS_SECTION)!
}

/**
 * 按中文名 / 描述 / 分组名过滤；空关键字返回完整 6 组。
 * 分组名命中时保留整组，否则只保留命中的二级项。
 */
export function filterSettingsGroups(query: string): SettingsGroupMeta[] {
  const keyword = query.trim().toLowerCase()
  if (keyword === '') {
    return [...SETTINGS_GROUPS]
  }
  const result: SettingsGroupMeta[] = []
  for (const group of SETTINGS_GROUPS) {
    if (group.label.toLowerCase().includes(keyword)) {
      result.push(group)
      continue
    }
    const sections = group.sections.filter(
      (item) =>
        item.label.toLowerCase().includes(keyword) ||
        item.description.toLowerCase().includes(keyword)
    )
    if (sections.length > 0) {
      result.push({ ...group, sections })
    }
  }
  return result
}
