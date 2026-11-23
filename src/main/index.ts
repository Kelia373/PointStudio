import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

import {
  DeepSeekProvider,
  DEEPSEEK_DEFAULT_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL
} from './ai/providers/deepseek.ts'
import type { Conversation, Message } from './ai/domain/conversation.ts'
import { JsonFileStore } from './data/fileStore.ts'
import { registerChatIpc } from './ipc/chat.ts'
import { registerConversationIpc } from './ipc/conversation.ts'
import { ConversationService } from './services/conversationService.ts'

// 这个文件只做三件事：创建窗口、加载页面、处理平台生命周期。
// 它是组合根：负责把内核目录接起来（注册通道、注入存储与凭据），但自己不含业务逻辑。

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

/** 数据落在 userData 目录：不进仓库，也不需要用户选路径。 */
function buildConversationService(): ConversationService {
  const dataDir = app.getPath('userData')
  return new ConversationService(
    new JsonFileStore<Conversation>(join(dataDir, 'conversations.json')),
    new JsonFileStore<Message>(join(dataDir, 'messages.json')),
    { newId: () => randomUUID(), now: () => new Date().toISOString() }
  )
}

void app.whenReady().then(() => {
  // 先注册通道再建窗，避免窗口刚起来就发消息、handler 还没就位。
  const conversations = buildConversationService()

  registerConversationIpc({ conversations })
  registerChatIpc({
    conversations,
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
