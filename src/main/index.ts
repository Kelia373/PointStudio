import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

import {
  DeepSeekProvider,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL
} from './ai/providers/deepseek.ts'
import { registerChatIpc } from './ipc/chat.ts'

// 这个文件只做三件事：创建窗口、加载页面、处理平台生命周期。
// 它是组合根：负责把内核目录接起来（比如注册 IPC 通道），但自己不含业务逻辑。

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 等首帧就绪再显示，避免看到白屏闪烁。
  window.on('ready-to-show', () => window.show())

  // 开发态由 electron-vite 注入 dev server 地址；生产态加载打包后的 html。
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

void app.whenReady().then(() => {
  // 先注册通道再建窗，避免窗口刚起来就发消息、handler 还没就位。
  registerChatIpc({
    engine: {
      provider: new DeepSeekProvider(),
      // 凭据只从进程环境读取：不落盘、不进仓库、不出现在任何提交里。
      // 设置界面做好之后，这里改成从 settings 服务注入。
      apiKey: process.env.DEEPSEEK_API_KEY ?? null,
      baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEEPSEEK_DEFAULT_BASE_URL,
      model: process.env.DEEPSEEK_MODEL ?? DEEPSEEK_DEFAULT_MODEL
    }
  })
  createWindow()

  // macOS：点 dock 图标且没有窗口时重开一个。
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// macOS 惯例是关窗不退出；其它平台关窗即退出。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
