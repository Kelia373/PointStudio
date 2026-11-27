# 全局设置 6 级架构与「API + CLI 双轨模型接入」施工单（L2）

- **状态**：Approved（主人已拍板落盘并移交开发施工）
- **日期**：2026-11-28
- **关联总纲**：[00-项目定位与边界.md](file:///D:/Project/PointStudio/docs/00-%E9%A1%B9%E7%9B%AE%E5%AE%9A%E4%BD%8D%E4%B8%8E%E8%BE%B9%E7%95%8C.md)

---

## 1. 目标（Goal）

将原本仅有 3 个扁平占位项的设置页（`SettingsPage.tsx` + `SettingsPanel.tsx`）升级为 **6 大一级分组 × 二级子模块的完整工作台设置中心**，并重点打通 **第一级 `AI Agent` 的模型接入体系**：

1. **6 大一级分组导航（左栏分级树）**：
   - **第一级：`AI Agent`**（`默认模型` · `模型服务` · `本地模型` · `路由编排` · `MCP` · `Skills` · `记忆与知识库` · `用量`）
   - **第二级：`基本设置`**（`通用设置` · `快捷键` · `代理` · `关于 PointStudio`）
   - **第三级：`工作流程`**（`Git 和源代码控制` · `自动化` · `终端` · `浏览器`）
   - **第四级：`界面`**（`外观与颜色` · `字体与字号` · `通知`）
   - **第五级：`实验性`**（`插件` · `实验特性开关`）
   - **第六级：`隐私和安全`**（`全局权限护栏` · `凭据管理` · `数据与备份`）
2. **模型服务双轨架构（`直连 API` + `CLI 智能体引擎`）**：
   - **轨道 A · 直连 API (`kind: 'api'`)**：支持 `DeepSeek`（与主进程 `window.pointstudio.settings` 实时双向同步）、`OpenAI 兼容接口 (OpenAI-Compatible)`（SiliconFlow / OpenRouter / Kimi / Qwen 等）、`Anthropic`、`Gemini`。
   - **轨道 B · CLI 智能体引擎 (`kind: 'cli'`)**：一等公民接入 **`OpenCode` (`opencode`)**、**`Paseo` (`paseo`)**、**`Devin` (`devin`)**、**`Claude Code` (`claude`)**、**`Codex CLI` (`codex`)** 及 **`Custom Command` (`command`)**；提供可执行命令、通信模式（`stdio-jsonl` / `acp` / `oneshot-text`）、参数模板（支持 `{{workspace}}` `{{model}}` `{{prompt}}` 占位符）及**与三档权限模式（`auto-edit` / `smart` / `full-access`）的命令行参数桥接预览**。
3. **默认模型四槽位 + 本地模型 + MCP 真通道点亮 + 备份迁入隐私安全**：
   - **默认模型四槽位**：`主对话与默认 Agent 模型`、`轻量快反模型（标题 / /side / 记忆提炼）`、`规划与小组拆单模型`、`知识库向量模型`。
   - **本地模型**：`Ollama`（与主进程 `ollama` 配置实时同步）与 `LM Studio` 免 Key 配置、常用本地模型勾选与上下文长度限制（`numCtx`）。
   - **MCP 服务面板点亮**：直接对接主进程已有的 `window.pointstudio.mcp.list / add / remove` 真实 IPC 通道，并支持切换展示 `HTTP/SSE` 与 `Stdio` 接入形态。
   - **备份迁移**：将原 `SettingsPanel.tsx` 底部的「导出（复制）/ 合并导入 / 整体恢复」迁移至 **第六级 `隐私和安全 → 数据与备份`**。
   - **全局模型下拉联动**：已启用的 API 模型、CLI 引擎（如 `cli:opencode`、`cli:paseo`、`cli:devin`、`cli:custom`）与本地模型自动汇入 `modelOptions.ts`，在新建/编辑智能体弹窗（`AgentCreateDialog.tsx`）和输入栏模型下拉中立即可选。

---

## 2. 假设与边界约束（Assumptions & Constraints）

1. **零破坏既有 IPC 契约**：
   - 主进程现有的 `SETTINGS_CHANNELS`（`readProvider` / `saveProvider` / `clearProvider`）及 `providerSettings.test.ts` 中对 `ProviderId = 'deepseek' | 'ollama'` 的断言保持 **100% 原样兼容，不破坏任何既有单测**。
   - 当用户在「模型服务 → DeepSeek」或「本地模型 → Ollama」保存配置时，继续调用 `window.pointstudio.settings.saveProvider(...)` 落盘到主进程凭据库，确保主进程 `chatEngine` 立即生效；同时多服务商扩展清单、CLI 引擎配置与默认模型四槽位通过纯函数状态模块 `src/renderer/src/lib/modelServices.ts` 持久化并驱动渲染层。
2. **遵循「先立功能骨架，后做集中 UI 精修」纪律**：
   - 严格使用 `src/renderer/src/styles/tokens.css` 既有语义变量，不写裸色值或裸毫秒；
   - 第一阶段重点保证 **6 级导航切换、双轨模型服务增删改查、默认四槽位持久化、MCP 增删、数据备份迁移、以及与 `AgentCreateDialog` 模型下拉的数据联动 100% 真实可用**；
   - 第三级「工作流程 → 浏览器」按定稿的**四层 Agent 浏览器架构**（免浏览器极速层 / `AXTree @eN` + `SoM` 视觉贴纸双模 / 右屏副驾接管与 `smart` 权限门联动 / 一次探路固化 Skill）落地配置骨架（驱动模式选择：`agent-browser / CDP 沙箱` vs `本机 CDP 端口挂接`、感知策略、权限门拦截开关、右屏副驾预览开关）。

---

## 3. 分步施工单（Step-by-Step Plan with Pure Functions & `expect`）

### Step 1：新建 6 级设置导航纯函数模块 `src/renderer/src/lib/settingsNav.ts` + 单测
定义 6 大一级分组与全部二级子项的元数据、默认选中项、分组查询与搜索过滤纯函数：

```ts
export type SettingsGroupId =
  | 'ai-agent'
  | 'basic'
  | 'workflow'
  | 'interface'
  | 'experimental'
  | 'privacy-security'

export type SettingsSectionId =
  // 1. AI Agent
  | 'default-models'
  | 'model-services'
  | 'local-models'
  | 'routing'
  | 'mcp'
  | 'skills'
  | 'memory-rag'
  | 'usage'
  // 2. 基本设置
  | 'general'
  | 'shortcuts'
  | 'proxy'
  | 'about'
  // 3. 工作流程
  | 'git'
  | 'automation'
  | 'terminal'
  | 'browser'
  // 4. 界面
  | 'appearance'
  | 'typography'
  | 'notifications'
  // 5. 实验性
  | 'plugins'
  | 'feature-flags'
  // 6. 隐私和安全
  | 'security-guardrails'
  | 'credentials'
  | 'data-backup'

export interface SettingsSectionMeta {
  id: SettingsSectionId
  groupId: SettingsGroupId
  label: string
  description: string
}

export interface SettingsGroupMeta {
  id: SettingsGroupId
  order: number
  label: string
  sections: SettingsSectionMeta[]
}
```
- **验收判据 (`expect`)**：
  - `SETTINGS_GROUPS` 严格包含 6 个一级分组（`order` 1~6），且「基本设置」不含重复的「显示」（显示归入第四级「界面 → 外观与颜色」），「数据与备份」归入第六级「隐私和安全」。
  - `findSettingsSection(id)` 对非法 ID 安全回退到 `'model-services'`（或 `'default-models'`）。
  - `filterSettingsGroups(query)` 支持按中文名或描述关键字过滤二级设置项，空关键字返回完整 6 组。

### Step 2：新建双轨模型服务（API + CLI + Local）与四槽位纯函数模块 `src/renderer/src/lib/modelServices.ts` + 单测
统一建模「直连 API 服务」「CLI 智能体引擎」「本地模型运行时」「默认模型四槽位」及「Agent 浏览器工作流配置」：

```ts
import type { AgentPermissionMode } from '../../../shared/types/ipc'

export type ModelServiceKind = 'api' | 'cli' | 'local'

export type ApiProtocolKind = 'openai-compatible' | 'deepseek' | 'anthropic' | 'gemini'

export type CliEnginePresetId =
  | 'opencode'
  | 'paseo'
  | 'devin'
  | 'claude-code'
  | 'codex'
  | 'custom-command'

export type CliTransportMode = 'stdio-jsonl' | 'acp' | 'oneshot-text'

export interface ApiProviderProfile {
  id: string
  kind: 'api'
  name: string
  protocol: ApiProtocolKind
  enabled: boolean
  baseUrl: string
  models: string[]
  defaultModel: string
  hasKey?: boolean
  maskedKey?: string
}

export interface CliEngineProfile {
  id: string
  kind: 'cli'
  preset: CliEnginePresetId
  name: string
  enabled: boolean
  executable: string
  transport: CliTransportMode
  argsTemplate: string
  /** 三档 UI 权限模式对应的附加命令行标志映射 */
  permissionFlags: Record<'auto-edit' | 'smart' | 'full-access', string>
  cwdPolicy: 'workspace' | 'custom'
  customCwd?: string
}

export interface LocalRuntimeProfile {
  id: 'ollama' | 'lm-studio'
  kind: 'local'
  name: string
  enabled: boolean
  baseUrl: string
  models: string[]
  numCtx: number
  keepAliveMinutes: number
}

export interface DefaultModelSlots {
  /** 主对话与新建 Agent 缺省模型（支持 'auto:panda' 或具体模型标识符） */
  primaryModel: string
  /** 轻量快反模型（会话标题、/side 旁路快问、Memory Spark 提炼） */
  fastModel: string
  /** 规划与智能体小组按 Soul 拆单模型 */
  plannerModel: string
  /** 知识库向量检索模型 */
  embeddingModel: string
}

export interface AgentBrowserWorkflowConfig {
  driver: 'agent-browser-sandbox' | 'local-cdp-attach'
  cdpPort: number
  perceptionMode: 'axtree-first' | 'som-visual-hybrid'
  smartGateOnSubmit: boolean
  rightPaneLivePreview: boolean
  autoSolidifySkill: boolean
}
```
- **核心纯函数与验收判据 (`expect`)**：
  1. `createDefaultModelServicesState()`：预置 API 服务（`DeepSeek`、`OpenAI 兼容 / SiliconFlow`、`Anthropic`、`Gemini`）、预置 6 类 CLI 引擎（`OpenCode`、`Paseo`、`Devin`、`Claude Code`、`Codex CLI`、`Custom Command`）、预置 2 类本地运行时（`Ollama 11434`、`LM Studio 1234`）以及默认四槽位。
  2. `buildCliInvocationPreview(profile, options: { permissionMode: AgentPermissionMode; workspace: string; model?: string; prompt: string })`：
     - 将 `argsTemplate` 中的 `{{workspace}}`、`{{model}}`、`{{prompt}}` 替换为真实值，并根据 `permissionMode`（非三档的历史值先通过 `uiPermissionMode` 归一）自动拼接对应的 `permissionFlags[mode]`；
     - `expect`：对 `opencode` 在 `full-access` 与 `smart` 下生成的命令预览准确包含对应权限标志且无多余空格。
  3. `collectAvailableModelOptions(state)`：
     - 汇总所有 `enabled: true` 的 API 模型、本地模型以及 CLI 引擎（格式如 `cli:opencode` 显示标签 `⚡ OpenCode (CLI)`、`cli:paseo` 显示标签 `⚡ Paseo (CLI)` 等），供 `modelOptions.ts`、`AgentCreateDialog.tsx` 与 `默认模型` 四槽位下拉直接消费。

### Step 3：升级 `src/renderer/src/lib/modelOptions.ts` 与 `AgentCreateDialog.tsx` 联动 + 单测
- 在 `modelOptions.ts` 中保持原有 `modelSelectOptions(providerId, current)` 与 `modelChoices(providerId, current)` 签名 **100% 兼容**（不破坏 `modelOptions.test.ts`），同时支持传入或合并来自 `modelServices.ts` 的已启用 API / CLI / 本地模型选项与 `MODEL_LABEL` 中文友好展示名（如 `cli:opencode` → `⚡ OpenCode · CLI 引擎`、`cli:paseo` → `⚡ Paseo · CLI 引擎`、`cli:devin` → `⚡ Devin · CLI 引擎`）。
- **验收判据 (`expect`)**：
  - 原有 `modelOptions.test.ts` 全绿；
  - 当在设置中启用 `OpenCode` 或 `Paseo` CLI 引擎，或在 API/本地模型中添加新模型后，`AgentCreateDialog` 的「模型」浮层下拉与设置页「默认模型」四槽位下拉均能立即选到该项。

### Step 4：重构 `SettingsPage.tsx` 与 `SettingsPanel.tsx` 为 6 级设置中心
- **左栏 (`settings-page__side`)**：
  - 顶部提供搜索过滤框（调 `filterSettingsGroups`）；
  - 按 6 大一级分组渲染分组标题与二级导航按钮。
- **右栏 (`settings-page__body`)**：
  - **`AI Agent → 模型服务 (model-services)`**：
    - 顶部双轨分段切换：**`直连 API 服务`** vs **`CLI 智能体引擎`**；
    - `直连 API` 轨：左侧服务列表（DeepSeek / OpenAI 兼容 / Anthropic / Gemini，带启用开关），右侧表单（API Key、接口地址 Base URL、模型列表增删、采样参数温度/maxTokens/topP）；当编辑 `deepseek` 时直通 `window.pointstudio.settings.saveProvider` 与 `clearProvider`；
    - `CLI 智能体引擎` 轨：左侧引擎列表（`OpenCode` / `Paseo` / `Devin` / `Claude Code` / `Codex CLI` / `Custom Command`，带启用开关），右侧表单（可执行命令 `executable`、通信协议 `transport`、参数模板 `argsTemplate`、三档权限参数映射表 `auto-edit / smart / full-access`、以及实时生成的 **命令行调用预览条**）。
  - **`AI Agent → 默认模型 (default-models)`**：
    - 4 张槽位配置卡（主对话模型、轻量快反模型、规划与小组拆单模型、知识库向量模型），支持从已启用的 API / CLI / 本地模型 + `🐼 Auto · 协同路由` 中选择并保存。
  - **`AI Agent → 本地模型 (local-models)`**：
    - `Ollama (127.0.0.1:11434)` 与 `LM Studio (127.0.0.1:1234)` 配置卡；切换并保存 Ollama 时直通 `window.pointstudio.settings.saveProvider({ providerId: 'ollama', ... })`；支持勾选/添加本地模型名与设置上下文窗口 `numCtx`。
  - **`AI Agent → 路由编排 (routing)`**：
    - `PandaRouter` 策略选择（性价比优先 / 质量优先 / 本地隐私优先）、升档梯队预览、以及智能体小组（Squad）按 `Soul` 拆单的最大并行 Worker 数与微回执 `Honesty Flags` 校验开关。
  - **`AI Agent → MCP 服务 (mcp)`**：
    - 直接接入 `window.pointstudio.mcp.list()`、`add({ serverName, url })`、`remove(serverName)` 真实 IPC 通道！展示已连接 MCP 服务列表、新增表单与断开按钮。
  - **`工作流程 → 浏览器 (browser)`**：
    - 落地四层 Agent 浏览器配置卡片（驱动模式：`agent-browser 独立沙箱` / `本机 Chrome CDP 端口挂接`；感知模式：`AXTree 无障碍树优先` / `AXTree + SoM 视觉数字贴纸双模`；安全护栏：`smart 模式下拦截表单提交与高危点击`；右屏画布：`在右屏 SecondaryPane 开启实时副驾画面与人工接管`；固化开关：`跑通一次后提示固化为本地 Skill`）。
  - **`隐私和安全 → 数据与备份 (data-backup)` & `凭据管理 (credentials)` & `全局权限护栏 (security-guardrails)`**：
    - `数据与备份` 完整承接原 `SettingsPanel` 的「导出（复制）」「合并导入」「整体恢复」真实 IPC 功能；
    - `全局权限护栏` 提供全工作区最高权限上限锁（如允许 `full-access` vs 全局锁死最高 `smart`）。
  - 其余二级子项均渲染对应的结构化配置卡片（拒绝空白页或敷衍的一句话提示）。

---

## 4. 要动的文件清单（Files to Touch）

- **新增纯函数与单测**：
  - `src/renderer/src/lib/settingsNav.ts`
  - `src/renderer/src/lib/__tests__/settingsNav.test.ts`
  - `src/renderer/src/lib/modelServices.ts`
  - `src/renderer/src/lib/__tests__/modelServices.test.ts`
- **修改现有渲染层模块与样式**：
  - `src/renderer/src/lib/modelOptions.ts`（扩展支持 CLI 引擎与多服务商模型列表，保持旧签名兼容）
  - `src/renderer/src/lib/__tests__/modelOptions.test.ts`（补齐 CLI 引擎与自定义模型合并单测）
  - `src/renderer/src/components/SettingsPage.tsx`（6 大一级分组左栏导航 + 二级模块路由）
  - `src/renderer/src/components/SettingsPanel.tsx`（拆分为双轨模型服务、默认四槽位、本地模型、MCP 真通道、浏览器四层配置、数据与备份等视图）
  - `src/renderer/src/components/AgentCreateDialog.tsx`（模型下拉联动 `modelServices` 中已启用的 API / CLI / 本地模型）
  - `src/renderer/src/styles/app.css`（仅使用 `tokens.css` 现有变量补齐设置页分组导航与双轨卡片布局，通过 `cssTokens.test.ts` 守卫）
- **文档与索引**：
  - `docs/00-项目定位与边界.md`
  - `docs/README.md`
  - `docs/notes/proposed/architecture/2026-11-28-settings-and-model-access.md`

---

## 5. 验收门禁（Verification Gates）

1. `npx tsc --noEmit` 零错误；
2. `npx vitest run` 全量测试通过（含新增的 `settingsNav.test.ts` 与 `modelServices.test.ts`，以及 `cssTokens.test.ts` / `ipcCoverage.test.ts`）；
3. `node scripts/tdd-gate.mjs` 与 `node scripts/gen-doc-index.mjs --check` 退出码均为 `0`；
4. `npm run build` 打包通过。
