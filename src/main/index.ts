import { app, BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DeepSeekProvider } from './ai/providers/deepseek.ts'
import type { Assistant } from './ai/domain/assistant.ts'
import type { Conversation, Message } from './ai/domain/conversation.ts'
import { resolveProviderConfig, type ProviderSettings } from './ai/domain/providerSettings.ts'
import { JsonFileStore } from './data/fileStore.ts'
import { registerAssistantIpc } from './ipc/assistant.ts'
import { registerChatIpc } from './ipc/chat.ts'
import { registerConversationIpc } from './ipc/conversation.ts'
import { registerSettingsIpc } from './ipc/settings.ts'
import { registerWorkspaceIpc } from './ipc/workspace.ts'
import { WorkspaceImportService } from './services/workspaceImportService.ts'
import { WorkspaceService } from './services/workspaceService.ts'
import { searchWorkspaceFiles } from './services/retrievalService.ts'
import type { WorkspaceFile } from './ai/domain/workspace.ts'
import { AssistantService } from './services/assistantService.ts'
import type { ChatEngineDeps } from './services/chatEngine.ts'
import { ConversationService } from './services/conversationService.ts'
import { ProviderSettingsService } from './services/providerSettingsService.ts'

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

interface Services {
  conversations: ConversationService
  assistants: AssistantService
  settings: ProviderSettingsService
  settingsFilePath: string
  workspace: WorkspaceService
  importer: WorkspaceImportService
  workspaceRoot: string
}

/** 数据落在 userData 目录：不进仓库，也不需要用户选路径。 */
function buildServices(): Services {
  const dataDir = app.getPath('userData')
  const deps = { newId: () => randomUUID(), now: () => new Date().toISOString() }
  const settingsFilePath = join(dataDir, 'provider.json')

  const workspaceRoot = join(dataDir, 'workspace')
  const workspace = new WorkspaceService(
    new JsonFileStore<WorkspaceFile>(join(dataDir, 'workspace.json')),
    deps
  )
  const importer = new WorkspaceImportService(workspace, {
    readSource: (absolutePath) => readFile(absolutePath, 'utf8'),
    writeStored: async (relativePath, content) => {
      await mkdir(workspaceRoot, { recursive: true })
      await writeFile(join(workspaceRoot, relativePath), content, 'utf8')
    }
  })

  return {
    workspace,
    importer,
    workspaceRoot,
    conversations: new ConversationService(
      new JsonFileStore<Conversation>(join(dataDir, 'conversations.json')),
      new JsonFileStore<Message>(join(dataDir, 'messages.json')),
      deps
    ),
    assistants: new AssistantService(new JsonFileStore<Assistant>(join(dataDir, 'assistants.json')), deps),
    settings: new ProviderSettingsService(new JsonFileStore<ProviderSettings>(settingsFilePath), {
      now: () => new Date().toISOString()
    }),
    settingsFilePath
  }
}

void app.whenReady().then(async () => {
  const services = buildServices()

  // 凭据优先级：设置界面保存过的 > 环境变量 > 默认（无 Key 时走本地假流式）。
  const savedSettings = await services.settings.read()
  const envConfig = {
    apiKey: process.env.DEEPSEEK_API_KEY ?? null,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? null,
    model: process.env.DEEPSEEK_MODEL ?? null
  }
  const resolved = resolveProviderConfig(savedSettings, envConfig)
  if (resolved.source === 'env') {
    console.info('[settings] 未保存凭据，使用环境变量中的模型配置')
  }

  // 引擎依赖是可变对象：设置里保存新凭据后原地替换，用户不必重启应用。
  const engine: ChatEngineDeps = {
    provider: new DeepSeekProvider(),
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model
  }

  // 先注册通道再建窗，避免窗口刚起来就发消息、handler 还没就位。
  registerConversationIpc({ conversations: services.conversations })
  registerWorkspaceIpc({ workspace: services.workspace, importer: services.importer })
  registerAssistantIpc({ assistants: services.assistants })
  registerSettingsIpc({
    settings: services.settings,
    onChange: (next) => {
      const applied = resolveProviderConfig(next, envConfig)
      engine.apiKey = applied.apiKey
      engine.baseUrl = applied.baseUrl
      engine.model = applied.model
    }
  })
  registerChatIpc({
    conversations: services.conversations,
    assistants: services.assistants,
    engine,
    // 检索是可选能力：工作区为空时它自然返回空数组，不影响对话。
    retrieval: {
      search: async (query) =>
        searchWorkspaceFiles(query, await services.workspace.list(), {
          readTextFile: (relativePath) => readFile(join(services.workspaceRoot, relativePath), 'utf8')
        })
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
