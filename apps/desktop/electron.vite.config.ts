import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// main / preload 跑在 Node 侧，依赖外部化；renderer 是普通 vite + React。
// 这里是整个桌面壳唯一的构建配置，改构建行为只改这个文件。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: { '@renderer': resolve('src/renderer/src') }
    },
    plugins: [react()],
    server: {
      // 本仓库所在的目录收不到 Windows 原生文件通知，热更新因此不触发。
      // 改用轮询：代价是轻微 CPU，换来「保存即生效」。
      watch: {
        usePolling: true,
        interval: 300
      }
    }
  }
})
