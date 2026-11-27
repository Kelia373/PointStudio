# src/main/core

**职责**：应用运行时。让「应用能跑起来」所需的、与业务无关的基础设施。

**判据**：把 `core` 整个抬到另一个 Electron 应用上，配上别的业务代码，那就是另一个应用——它不知道 PointStudio 是做什么的。这条判据来自 Cherry Studio 的 `core` 定义。

## 内容（对齐 Cherry `src/main/core/`）

| 模块 | 职责 |
|---|---|
| `lifecycle/` | 服务生命周期、DI 容器、分阶段启动（preboot / bootstrap / running） |
| `paths/` | 路径注册表：定义的只是一组具名路径，具体值由外壳注入 |
| `logger/` | 日志接口、分级、格式化；落盘 / stdout 由外壳注入 |
| `window/` | 窗口管理的抽象契约 |
| `scheduler/` | 调度器与作业队列（不依赖 Electron，纯计时与状态机） |
| `security/` | IPC 来源信任的**机制**部分（谁能发消息）；**规则**部分在 `policy` |

## 铁律

1. **与业务无关**：不认识会话、任务、产物。出现这些词就是放错了地方。
2. **进 `core` 的门槛是「应用离不开它」**：可移除的能力即便启动早期就要跑，也去 `services` 或 `ai`。
3. **Electron 绑定由外壳注入**：`core` 只定义接口与纯逻辑，`src/main` 提供实现。这是企业版服务端能换一套运行时的唯一办法。
4. **`core` 被所有层依赖，它自己不依赖任何包**（除 `utils`）。

## 禁止

- `react` / 渲染进程代码；
- 业务概念（`Task` / `Session` / `Artifact` / `Message`）；
- 直接调用 `app.getPath()`、`BrowserWindow` 等 Electron API —— 走注入。

## 现状

已有 `paths.ts`：数据文件路径注册表（`conversations.json` / `messages.json` / `assistants.json` / `provider.json` / `workspace.json` / `workspace/` / `crash/`）。这些文件名是事实上的数据契约——改名等于让旧数据消失，因此集中一处并有测试锁住。其余子模块（lifecycle / logger / window / scheduler / security）仍为空壳。
