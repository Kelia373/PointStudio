// core/paths —— 数据文件路径注册表。
//
// 为什么这属于 core 而不是 data：它只描述"应用把东西放在哪"，
// 不知道任何业务概念；换一个应用同样适用。
//
// 注意：这些文件名是**事实上的数据契约**——改名等于让用户的旧数据凭空消失，
// 所以集中一处并有测试锁住，不允许在各自的 service 里硬编码字符串。
import { join } from 'node:path'

export interface DataPaths {
  /** 数据根目录（Electron 的 userData）。 */
  dataDir: string
  conversations: string
  messages: string
  assistants: string
  providerSettings: string
  /** 多服务商凭据库：一家一条，互不覆盖。 */
  providerAccounts: string
  /** 本地 Token 账本。 */
  usageLedger: string
  workspaceIndex: string
  /** 工作区文件内容所在目录。 */
  workspaceRoot: string
  /** 聊天附图（图片本体单独落盘，绝不进 messages.json）。 */
  attachmentsDir: string
  /** 崩溃报告目录。 */
  crashDir: string
}

export function buildDataPaths(userDataDir: string): DataPaths {
  const dataDir = userDataDir.replace(/[\\/]+$/, '')
  return {
    dataDir,
    conversations: join(dataDir, 'conversations.json'),
    messages: join(dataDir, 'messages.json'),
    assistants: join(dataDir, 'assistants.json'),
    providerSettings: join(dataDir, 'provider.json'),
    providerAccounts: join(dataDir, 'provider-accounts.json'),
    usageLedger: join(dataDir, 'usage-ledger.json'),
    workspaceIndex: join(dataDir, 'workspace.json'),
    workspaceRoot: join(dataDir, 'workspace'),
    attachmentsDir: join(dataDir, 'attachments'),
    crashDir: join(dataDir, 'crash')
  }
}
