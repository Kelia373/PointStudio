// 剪贴板：标准 API 有超时保护，失败或卡住都退到 execCommand。
//
// 踩过的坑：`navigator.clipboard.writeText` 在某些环境（权限被拒、无用户手势、
// 弹窗被拦截）不是 reject 而是**永不 resolve**，于是 await 它的 UI 会一直
// 停在「复制中」。所以这里用 300ms 竞速，超时就走老路。
const API_TIMEOUT_MS = 300

export async function copyToClipboard(text: string): Promise<boolean> {
  // 首选主进程：没有权限与手势约束（浏览器 API 在某些环境永不 resolve）。
  const bridge = window.pointstudio?.clipboard
  if (bridge) {
    try {
      if (await bridge.writeText(text)) {
        return true
      }
    } catch {
      // 主进程不可用就往下走浏览器方案，不把异常抛给界面。
    }
  }

  const viaApi = await Promise.race([
    writeViaApi(text),
    new Promise<boolean>((resolve) => {
      window.setTimeout(() => resolve(false), API_TIMEOUT_MS)
    })
  ])
  if (viaApi) {
    return true
  }
  return legacyCopy(text)
}

async function writeViaApi(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}
