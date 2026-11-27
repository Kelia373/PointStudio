// lib/pageNav —— 主舞台的页面切换规则。
//
// 为什么不写在组件里：这套规则是「点进去出不来」那类死路的唯一出口，
// 而它只是几个字符串判断——抽成纯函数就能被测试钉住。
//
// 两条硬规则：
// 1. 功能项是 toggle：已经在那一页，再点一次就回聊天；
// 2. 点会话 / 新建会话 / 点「主聊天」永远是回聊天——顶栏、右栏都按会话渲染，
//    主舞台却停在功能页，界面就是精神分裂的。

export const CHAT_PAGE = 'chat'

/** 点侧栏功能项之后应该停在哪个页面。 */
export function nextActivePage(current: string, clicked: string): string {
  if (clicked === CHAT_PAGE) {
    return CHAT_PAGE
  }
  return clicked === current ? CHAT_PAGE : clicked
}

/** 点会话项 / 新建会话之后应该停在哪个页面。 */
export function pageAfterSessionPick(): string {
  return CHAT_PAGE
}

/** 顶栏标题：功能页显示页面标题，聊天页显示会话标题。 */
export function pageTitleOf(
  page: { title: string } | null,
  conversationTitle: string | null
): string {
  if (page) {
    return page.title
  }
  return conversationTitle ?? 'PointStudio'
}
