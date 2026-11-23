import { contextBridge } from 'electron'

// 预加载层是 renderer 与 main 之间唯一的桥。
// 现在只暴露一个版本号，用来证明这条链路是通的；后续所有 IPC 能力都必须从这里白名单式导出，
// 不允许在 renderer 里直接 import electron。

contextBridge.exposeInMainWorld('pointstudio', {
  electronVersion: process.versions.electron
})
