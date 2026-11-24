import { app, BrowserWindow, Menu } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { DeepSeekProvider } from './ai/providers/deepseek.ts'
import { OllamaProvider } from './ai/providers/ollama.ts'
import type { ChatProvider } from './ai/providers/types.ts'
import type { ProviderId } from './ai/domain/providerSettings.ts'
import type { Assistant } from './ai/domain/assistant.ts'
import type { Conversation, Message } from './ai/domain/conversation.ts'
import { resolveProviderConfig, type ProviderSettings } from './ai/domain/providerSettings.ts'
import { JsonFileStore } from './data/fileStore.ts'
import { buildDataPaths } from './core/paths.ts'
import { registerAssistantIpc } from './ipc/assistant.ts'
import { registerChatIpc } from './ipc/chat.ts'
import { registerConversationIpc } from './ipc/conversation.ts'
import { registerSettingsIpc } from './ipc/settings.ts'
import { registerAgentIpc } from './ipc/agent.ts'
import { registerBackupIpc } from './ipc/backup.ts'
import { registerMcpIpc } from './ipc/mcp.ts'
import { registerClipboardIpc } from './ipc/clipboard.ts'
import { McpConnections } from './services/mcpConnections.ts'
import { BackupService } from './services/backupService.ts'
import { registerWorkspaceIpc } from './ipc/workspace.ts'
import { ToolRegistry } from './ai/tools/registry.ts'
import { createBuiltinTools } from './ai/tools/builtin/index.ts'
import { recordCrash } from './services/crashLogService.ts'
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
    // 三栏（64 + 主区 + 320）在这个尺寸下才不会互相压扁；
    // 再小就交给 CSS 折叠：侧栏变图标轨、检查器可收起。
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    // 与默认深色主题一致，否则启动瞬间会闪一下白底。
    backgroundColor: '#0a0a0b',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 菜单栏已移除，默认的 Ctrl+Shift+I / F12 也没了。
  // 开发态自己留一个 F12，免得每次都要去翻 devtools 端口。
  if (process.env.ELECTRON_RENDERER_URL) {
    window.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        window.webContents.toggleDevTools()
      }
    })
  }

  // 等首帧就绪再显示，避免看到白屏闪烁。
  window.on('ready-to-show', () => window.show())

  // 开发态由 electron-vite 注入 dev server 地址；生产态加载打包后的 html。
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** 平台选择：新增平台只加一行。 */
function createProvider(id: ProviderId): ChatProvider {
  return id === 'ollama' ? new OllamaProvider() : new DeepSeekProvider()
}

interface Services {
  conversations: ConversationService
  assistants: AssistantService
  settings: ProviderSettingsService
  settingsFilePath: string
  workspace: WorkspaceService
  importer: WorkspaceImportService
  workspaceRoot: string
  backup: BackupService
}

/** 数据落在 userData 目录：不进仓库，也不需要用户选路径。 */
function buildServices(): Services {
  const paths = buildDataPaths(app.getPath('userData'))
  const deps = { newId: () => randomUUID(), now: () => new Date().toISOString() }

  const workspace = new WorkspaceService(new JsonFileStore<WorkspaceFile>(paths.workspaceIndex), deps)
  const importer = new WorkspaceImportService(workspace, {
    readSource: (absolutePath) => readFile(absolutePath, 'utf8'),
    writeStored: async (relativePath, content) => {
      await mkdir(paths.workspaceRoot, { recursive: true })
      await writeFile(join(paths.workspaceRoot, relativePath), content, 'utf8')
    }
  })

  const conversationStore = new JsonFileStore<Conversation>(paths.conversations)
  const messageStore = new JsonFileStore<Message>(paths.messages)
  const assistantStore = new JsonFileStore<Assistant>(paths.assistants)

  return {
    backup: new BackupService(conversationStore, messageStore, assistantStore, {
      now: () => new Date().toISOString()
    }),
    conversations: new ConversationService(conversationStore, messageStore, deps),
    assistants: new AssistantService(assistantStore, deps),
    settings: new ProviderSettingsService(new JsonFileStore<ProviderSettings>(paths.providerSettings), {
      now: () => new Date().toISOString()
    }),
    settingsFilePath: paths.providerSettings,
    workspace,
    importer,
    workspaceRoot: paths.workspaceRoot
  }
}

/**
 * 崩溃落盘：写 userData/crash/ 并轮转。只在本机，不外传——个人版红线。
 */
function installCrashRecorder(
  dataDir: string
): (error: Error, context?: Record<string, unknown>) => void {
  const crashDir = buildDataPaths(dataDir).crashDir
  const env = {
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron
  }

  return (error, context = {}) => {
    void (async () => {
      try {
        await mkdir(crashDir, { recursive: true })
        await recordCrash(error, context, {
          now: () => new Date().toISOString(),
          env,
          writeFile: (name, content) => writeFile(join(crashDir, name), content, 'utf8'),
          listFiles: () => readdir(crashDir),
          removeFile: (name) => rm(join(crashDir, name), { force: true })
        })
      } catch {
        // 连崩溃日志都写不下去时只能放弃——不能让它再抛一次。
        console.error('[crash] 记录失败')
      }
    })()
  }
}

void app.whenReady().then(async () => {
  // 去掉 Electron 默认菜单（File / Edit / View / Window）：
  // 这是桌面工具，不是浏览器，菜单栏除了占一行没有任何用处。
  // 代价是默认快捷键（Ctrl+R / Ctrl+Shift+I）一起没了，开发期用 F12 开调试台兜住。
  Menu.setApplicationMenu(null)

  const services = buildServices()

  // 主进程未捕获异常落盘；宿主进程不可用时不阻断启动。
  const recordCrashToDisk = installCrashRecorder(app.getPath('userData'))
  process.on('uncaughtException', (error) => recordCrashToDisk(error, { source: 'main' }))
  process.on('unhandledRejection', (reason) =>
    recordCrashToDisk(reason instanceof Error ? reason : new Error(String(reason)), {
      source: 'main'
    })
  )

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
    provider: createProvider(resolved.providerId),
    params: resolved.params,
    apiKey: resolved.apiKey,
    baseUrl: resolved.baseUrl,
    model: resolved.model
  }

  // 先注册通道再建窗，避免窗口刚起来就发消息、handler 还没就位。
  registerConversationIpc({ conversations: services.conversations })
  registerWorkspaceIpc({
    workspace: services.workspace,
    importer: services.importer,
    readStoredFile: (relativePath) => readFile(join(services.workspaceRoot, relativePath), 'utf8')
  })
  registerBackupIpc({ backup: services.backup })
  registerClipboardIpc()

  // 工具注册表：内置只读工具 + 工作区读取。MCP 工具待传输层落地后再注册。
  const tools = new ToolRegistry()
  for (const tool of createBuiltinTools({
    readTextFile: (relativePath) => readFile(join(services.workspaceRoot, relativePath), 'utf8')
  })) {
    tools.register(tool)
  }
  registerAgentIpc({ engine, tools })

  // 外部 MCP 服务：接入的工具进同一个注册表，Agent 因而能直接调用。
  const mcpConnections = new McpConnections(tools)
  registerMcpIpc({ connections: mcpConnections })
  app.on('before-quit', () => mcpConnections.removeAll())
  registerAssistantIpc({ assistants: services.assistants, conversations: services.conversations })
  registerSettingsIpc({
    settings: services.settings,
    onChange: (next) => {
      const applied = resolveProviderConfig(next, envConfig)
      engine.provider = createProvider(applied.providerId)
      engine.params = applied.params
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
