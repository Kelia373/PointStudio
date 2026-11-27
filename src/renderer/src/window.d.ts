// 渲染进程的全局类型声明：把 preload 挂到 window 上的能力告诉 TypeScript。
// 没有这个文件，窗口里的 window.pointstudio 全是 any，写错了也编译得过。
import type { PointStudioApi } from '../../shared/types/ipc.ts'

declare global {
  interface Window {
    pointstudio: PointStudioApi
  }
}

export {}
