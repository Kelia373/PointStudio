// core/externalLink —— 外链安全判定（纯函数，供主进程与单测共用）。
//
// Electron 里 `<a target="_blank">` 默认会开一个子 BrowserWindow；
// 必须只把 http(s)/mailto 交给系统浏览器，其余协议（javascript:/file:/data:）一律拒绝。
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

/**
 * 是否是应用自身页面内的导航。
 * WHATWG 里 file:// 的 origin 恒为字符串 'null'，不能拿 origin 比较；
 * 打包态只放行同 pathname 的 file 跳转，避免任意本地文件被当成「同源」。
 */
export function isInternalNavigation(currentUrl: string, targetUrl: string): boolean {
  try {
    const current = new URL(currentUrl)
    const target = new URL(targetUrl)
    const httpLike = current.protocol === 'http:' || current.protocol === 'https:'
    if (httpLike && current.origin === target.origin) {
      return true
    }
    return (
      current.protocol === 'file:' &&
      target.protocol === 'file:' &&
      current.pathname === target.pathname
    )
  } catch {
    return false
  }
}

export function isSafeExternalUrl(raw: string): boolean {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return false
  }
  try {
    const url = new URL(raw.trim())
    return SAFE_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}
