# 渲染层整改施工单（为插件化铺路）

> **状态：施工单，尚未开工。**
> 目标不是"先写插件系统"，而是把渲染层改成**能挂插件的形状**。
> 插件作者看到的 API 见 [plugin-development.md](./plugin-development.md)。

---

## 1. 为什么要整改：现状的三个硬伤

| 硬伤 | 证据 | 后果 |
| --- | --- | --- |
| **没有壳** | `App.tsx` 只有 6 行，直接 `<ChatPanel />` | 第三方页面没有位置可挂 |
| **状态在组件里** | `ChatPanel.tsx` 823 行，会话/消息/流式/抽屉/计划全在其中 | 插件页读不到任何共享状态；覆盖组件后状态跟着组件跑，必炸 |
| **组件写死引用** | `ChatPanel` 里 `import MessageBubble from './MessageBubble'` 等 9 处 | 无法替换内置组件，"改任何东西"是空话 |
| **样式单体** | `app.css` 1793 行，所有组件混在一起 | 插件无法只带自己的样式、也无法复用主题 |
| **无共享 React 约束** | `electron.vite.config.ts` 里 renderer 没有任何 externals | 插件组件一挂就崩（两份 React） |

已经**具备**的好底子（不要推翻）：

- `tokens.css` 是单一真相源（颜色/圆角/间距/字号/动效）
- 组件已部分拆开：`Sidebar` / `Composer` / `Inspector` / `MessageBubble` / `ConfirmButton`
- 纯函数层已存在：`lib/chatState.ts`、`lib/planRunState.ts`、`lib/modelOptions.ts`、`lib/filterConversations.ts`
- `SettingsPage.tsx` 已经是一个"页面 → 返回"的雏形（72 行，左栏模块 + 右栏内容）

---

## 2. 目标结构

```
src/renderer/src/
├── App.tsx                 组装 Shell；不再直接渲染任何业务面板
├── shell/
│   ├── Shell.tsx           壳：导航 + 内容区 + 全局横幅 + 抽屉宿主
│   ├── NavRail.tsx         导航项来自路由注册表（可折叠成图标轨）
│   ├── PageHost.tsx        渲染当前页；插件页走同一入口
│   └── PageBoundary.tsx    每页一个 ErrorBoundary（插件崩了不带走壳）
├── routes/
│   ├── registry.ts         PageDefinition 注册表（内置 + 插件）
│   └── builtin/chat.tsx    现 ChatPanel 变为一个页面
├── store/
│   ├── chatStore.ts        会话/消息/流式/计划状态
│   └── settingsStore.ts    provider 视图
├── registry/
│   ├── components.ts       组件注册表（键 → 实现），内置组件也注册进来
│   └── slots.ts            插槽锚点
├── plugins/                （P2 才建）
│   ├── loader.ts
│   └── context.ts
└── styles/
    ├── tokens.css
    ├── themes/{default,warm,contrast}.css   （P2）
    └── components/*.css                     （按组件拆）
```

---

## 3. 分阶段任务

### P0：壳 + 状态外置 + 组件注册表（行为零变化）

| # | 改什么 | 做什么 | 验收判据 |
| --- | --- | --- | --- |
| 0.1 | `routes/registry.ts`（新） | 定义 `PageDefinition`：`{ id, title, icon, order, kind, component }`；内置页先只登记 `chat` 与 `settings` | 单测：注册/重名拒绝/按 order 排序 |
| 0.2 | `shell/Shell.tsx` + `PageHost.tsx`（新） | 壳渲染导航（来自注册表）+ 内容区（当前页）；`settings` 从抽屉改为整页 | 现有功能逐条走通 |
| 0.3 | `store/chatStore.ts`（新） | 把 `ChatPanel` 里的 `conversations/messages/busy/planRun/mode` 等状态与事件订阅搬进 store；组件只订阅 | `ChatPanel` 行数降到 ≤400；流式与停止功能不回退 |
| 0.4 | `registry/components.ts`（新） | 内置组件注册为 `chat.bubble` / `chat.composer` / `chat.empty` / `sidebar.item` / `settings.section`；页面里改为**从注册表取** | 全仓 `grep "import MessageBubble"` 归零 |
| 0.5 | `electron.vite.config.ts` | renderer 加 `rollupOptions.external: ['react', 'react-dom']`（P0 只做配置与单实例验证，不加载插件） | 构建通过；宿主仍正常渲染 |
| 0.6 | 样式拆分 | `app.css` 按区块拆到 `styles/components/*.css`；`app.css` 只留 import 与基础重置 | 无视觉回归（深浅两主题截图比对） |

**P0 的停止条件**：`tsc` 通过、353 单测全绿、`electron-vite build` 通过、真窗口功能逐条走通。
任何一条不满足就退回上一小步，不硬推。

### P1：插件加载（只支持我们自己写的插件）

| # | 做什么 | 验收 |
| --- | --- | --- |
| 1.1 | `plugins/loader.ts`：从指定目录读 `package.json` → 校验 `apiVersion` → 执行 `renderer` 入口的 `apply(ctx)` | 手写一个 `hello` 插件能在导航里出现 |
| 1.2 | `plugins/context.ts`：组装 `RendererContext`（`pages` / `slots` / `data.snapshot` / `events` / `storage` / `theme`） | `data.snapshot()` 返回真实数据（只读） |
| 1.3 | `shell/PageBoundary.tsx`：每页 ErrorBoundary + 插件状态机（`enabled/disabled/quarantined`） | 故意抛错的插件只坏自己那页 |
| 1.4 | 插件列表页：启用/禁用/卸载 | 禁用后导航项消失，重启后状态保持 |

### P2：覆盖内置组件 + 主题包 + 主进程侧入口

| # | 做什么 | 验收 |
| --- | --- | --- |
| 2.1 | `components.override(key, factory)` | 用插件替换 `chat.bubble`，渲染成自定义气泡 |
| 2.2 | 主题包：`themes/*.css` + 设置里切换 | 切主题不改结构，只换 token |
| 2.3 | Host 入口（主进程 `apply(ctx)`）：工具/命令/IPC 前缀隔离 | 插件注册一个工具，Agent 能调用 |

---

## 4. 组件注册表的键与 props 契约

键名一经公开即为契约。新增字段只能可选；删改必须升 `apiVersion` 并保留一版兼容层。

| 键 | 现有实现 | 必须保留的 props |
| --- | --- | --- |
| `chat.bubble` | `MessageBubble.tsx` | `role, content, streaming, failed, references, onCopy, onDelete, onResend, onReference` |
| `chat.composer` | `Composer.tsx` | `draft, busy, canSend, model, models, effort, onDraftChange, onSend, onStop, onPlan, onModelChange, onEffortChange` |
| `chat.empty` | `EmptyState.tsx` | `mode, onPick` |
| `sidebar.item` | `Sidebar.tsx` 内联 | `conversation, active, onSelect, onRemove` |
| `settings.section` | `SettingsPanel.tsx` | `section, onChange` |

---

## 5. 迁移顺序与风险控制

1. **一步一提交**，每步都能独立回滚；P0 内不允许同时改契约与样式。
2. **先搬状态再搬 UI**：0.3 必须在 0.4 之前完成，否则注册表里的组件拿到的是组件内部状态，等于没解决。
3. **不动主进程契约**：P0/P1 只改 `src/renderer`；需要主进程配合的（工具注册、IPC 前缀）放到 P2。
4. **行为对拍**：每完成一小步，用同一份测试数据手动走一遍（发消息 / 停止 / 切会话 / 计划 / 设置 / 导出），记录与整改前的差异。
5. **不引入新运行时依赖**：store 用 React 自带能力（`useSyncExternalStore`）实现，不上 Redux/Zustand。

---

## 6. 明确不做

- ❌ 不在 P0 引入插件沙箱（先把形状做对，隔离在 P2 之后）
- ❌ 不做插件市场（先有 3 个官方插件做样板）
- ❌ 不替换 React / 引入新的状态库
- ❌ 不动 `src/main` 的目录分层与 IPC 白名单机制

---

## 7. 完成后的样子

- 加一个"会话拓扑图"功能 = 写一个插件目录，不改宿主代码
- 换个消息气泡 = 在插件里 `components.override('chat.bubble', …)`
- 换套皮 = 加一个主题包
- 插件崩了 = 那一页变错误卡片，壳与其它页面照常，导航里可一键禁用

---

## 8. 相关文档

- 插件作者视角：[plugin-development.md](./plugin-development.md)
- 主进程分层与依赖方向：[architecture/main-architecture.md](./architecture/main-architecture.md)
- 渲染层现有约定：[architecture/renderer.md](./architecture/renderer.md)
