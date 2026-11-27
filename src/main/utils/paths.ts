// utils/paths —— 路径安全相关的纯函数。
//
// 放在 utils 是因为它零依赖、与业务无关，且被 `ai`（内置工具）与 `services`
// （工作区导入）同时需要——这正是 utils 的判据：被两个以上包用，且不懂业务。

/**
 * 是否为「工作区内的相对路径」。
 * 拦截：空路径、绝对路径、Windows 盘符路径、`..` 穿越。
 */
export function isSafeRelativePath(candidate: string): boolean {
  const path = candidate.trim()
  if (path === '') {
    return false
  }
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/.test(path)) {
    return false
  }
  return path.split(/[\\/]+/).every((segment) => segment !== '..')
}

/** 统一分隔符并去掉开头的 `./`，用于存储与比较；不负责安全性校验。 */
export function normalizeRelativePath(candidate: string): string {
  return candidate
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\.\//, '')
}
