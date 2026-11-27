// shared/utils/format —— 跨进程共用的纯函数。
//
// 放在 shared 的判据：**两边都在用**（主进程与渲染进程各加载一次）。
// 只允许纯函数与常量，不许状态。

/**
 * 字节数转人读字符串。
 * 无效值（NaN / 负数）一律按 0 处理——界面宁可显示 0 B，也不要显示 NaN。
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '0 B'
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
