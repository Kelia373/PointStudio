// core/externalLink —— 外链安全判定（纯函数，供主进程与单测共用）。
//
// Electron 里 `<a target="_blank">` 默认会开一个子 BrowserWindow；
// 必须只把 http(s)/mailto 交给系统浏览器，其余协议（javascript:/file:/data:）一律拒绝。
const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

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
