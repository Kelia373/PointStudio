# src/main/ipc

**职责**：跨进程边界。主进程与渲染进程之间**唯一**的受控通道。

## 内容

- 请求 / 事件的 schema 定义（类型 + 运行时校验）
- 路由注册与分发
- 错误模型与映射
- 来源校验（谁能发这条消息）

## 铁律

1. **handler 必须轻薄**：校验参数 → 委托业务 → 映射错误。业务判断不写在这里。
2. **一个域一个文件**，按域组织；不要按操作拆。
3. **所有通道必须在 schema 里声明**，禁止裸 `ipcMain.on` —— 否则渲染进程可以调任何东西而无从审计。
4. **错误要归一**：底层异常（DB、网络）在边界处映射为稳定的错误码，不把原始堆栈透给渲染进程。

## 禁止

- `react` / 渲染进程代码；
- 在 handler 里实现业务逻辑（那是 `ai` / `services` 的事）；
- 让渲染进程能绕过 schema 直接触达存储或模型。

## 依赖

允许依赖 `core`（运行时抽象）、`ai` / `services`（业务入口）；被 `src/main` 组装。

## 现状

运行时校验集中在 `validators.ts`（不依赖 electron，可直接单测）：UUID、聊天请求、会话创建、助手草稿、设置草稿、计划请求、工作区路径。handler 只调这些判断，不再各自复制正则。

已注册 `chat`、`conversation`、`assistant`、`settings`、`workspace`、`agent` 六个域。`agent.ts` 跑一个目标并用事件推过程（plan/step/replan/done）。`workspace.ts` 只收绝对路径，读源/落盘/登记全在主进程完成。`settings.ts` 负责模型凭据：读只返回脱敏视图，明文永不出主进程。`conversation.ts` 走 invoke（列表/建/改名/删/消息/绑助手），`assistant.ts` 走 invoke（增删改查），领域错误码原样返回不翻译成文案。

`chat` 域（`chat.ts`）：`chat:send` 走 `ipcMain.handle`，推流用 `webContents.send`
走 `chat:chunk` / `chat:done` / `chat:error`。通道名与载荷类型在 `src/shared/types/ipc.ts`。
参数在边界处做运行时校验（TS 类型在跨进程时不存在），错误归一为错误码。
