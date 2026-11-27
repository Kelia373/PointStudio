// 会话搜索：纯函数，便于在 node 单测里直接跑（组件里只做展示）。
import type { ConversationDto } from '../../../shared/types/ipc.ts'

/**
 * 按标题过滤会话。
 *
 * - 关键字先 trim 并转小写，空关键字返回原列表（不要返回空数组——那会让列表整片消失）
 * - 不排序：列表顺序由主进程给（按更新时间），搜索不该改变心智位置
 */
export function filterConversations(
  conversations: ConversationDto[],
  keyword: string
): ConversationDto[] {
  const needle = keyword.trim().toLowerCase()
  if (needle === '') {
    return conversations
  }
  return conversations.filter((conversation) =>
    conversation.title.toLowerCase().includes(needle)
  )
}
