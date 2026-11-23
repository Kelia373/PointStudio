import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

// 这个文件只做三件事：创建窗口、加载页面、处理平台生命周期。
// 任何业务逻辑都不允许出现在这里 —— 它属于 packages/。

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
