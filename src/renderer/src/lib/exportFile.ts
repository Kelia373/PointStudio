// lib/exportFile —— 会话导出的文件名与落盘。
//
// 主进程的 exportMarkdown 只回 Markdown 文本（不碰磁盘），落盘由渲染层做：
// 这样导出位置交给用户浏览器/系统的下载目录，不需要新增权限。

const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g
/** 文件名长度上限：给路径与扩展名留余量。 */
const MAX_TITLE = 40

/** 会话标题 → 安全的 .md 文件名。空标题给占位名，绝不出「.md」这种文件。 */
export function exportFileName(title: string | null): string {
  const safe = (title ?? '')
    .trim()
    .replace(UNSAFE, '-')
    .replace(/\s+/g, ' ')
    .slice(0, MAX_TITLE)
    .trim()
  return `pointstudio-${safe === '' ? '未命名会话' : safe}.md`
}

/** 把文本作为文件交给系统下载。返回是否成功（DOM 不可用时为 false）。 */
export function downloadText(fileName: string, text: string): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false
  }
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // 交给下一轮事件循环回收，立刻 revoke 会让部分浏览器的下载中断。
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  return true
}
