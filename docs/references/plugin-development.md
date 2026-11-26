# 插件开发指南（设计规格）

> **状态：设计规格，尚未实现。**
> 本文定义「写一个 PointStudio 插件」的目标形态，以及宿主需要提供什么。
> 实现进度见文末「实现状态」，请勿把未完成的部分当成可用能力。

---

## 1. 这个插件模型长什么样

参照 DSH 的 bundle 模型，但**只保留我们需要的部分**：

| 概念 | 是什么 |
| --- | --- |
| **bundle** | 一个目录（通常是一个 npm 包），含 `manifest` 与两个入口 |
| **Host 入口** | 跑在主进程（Node）的 `apply(ctx)`：注册工具、IPC、命令、事件监听 |
| **Renderer 入口** | 跑在渲染进程的 `apply(ctx)`：注册页面、插槽内容、覆盖内置组件 |
| **注册表** | 宿主维护的挂载点集合；内置实现与插件实现走同一张表 |
| **Context** | 宿主传给插件的唯一对象；插件不许直接摸 `window.pointstudio` 或 `require('electron')` |

**能力边界由插件自己决定，安装即信任。** 这是刻意的选择：自由度优先。
宿主只保留三条硬边界（见 §7），以及崩溃后的兜底（见 §8）。

---

## 2. bundle 目录结构

```
my-plugin/
├── package.json          # 名字、版本、两个入口 + contributes 声明
├── main.js               # Host 入口（可选）
├── renderer.js           # Renderer 入口（可选）
├── icon.svg              # 插件图标（导航与列表用）
└── README.md
```

`package.json` 的关键字段：

```json
{
  "name": "pointstudio-plugin-graph",
  "version": "1.0.0",
  "pointstudio": {
    "apiVersion": 1,
    "displayName": "会话拓扑",
    "main": "./main.js",
    "renderer": "./renderer.js",
    "icon": "./icon.svg",
    "contributes": {
      "pages": [
        { "id": "graph", "title": "会话拓扑", "icon": "share-2", "order": 20 }
      ],
      "commands": [
        { "id": "graph.open", "title": "打开会话拓扑" }
      ]
    }
  }
}
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `pointstudio.apiVersion` | ✅ | 宿主 API 版本，见 §6 |
| `displayName` | ✅ | 插件列表与导航里显示的名字 |
| `main` / `renderer` | 至少一个 | 两个入口可以只写一个 |
| `contributes.pages` | 否 | 声明的页面；实现必须在 `renderer` 里注册同名 id |
| `contributes.commands` | 否 | 命令面板项 |

---

## 3. Renderer Context API

```ts
interface RendererContext {
  /** 页面：会出现在导航里，由壳渲染内容区 */
  pages: {
    register(def: {
      id: string
      title: string
      icon?: string
      order?: number
      render: (mount: HTMLElement) => () => void   // 返回卸载函数
    }): () => void
  }

  /** 插槽：往宿主预留的位置塞组件 */
  slots: {
    register(slot: SlotName, render: (mount: HTMLElement) => () => void): () => void
  }

  /** 覆盖内置组件（键名见 §5） */
  components: {
    override(key: ComponentKey, factory: () => Promise<{ default: ComponentType<any> }>): void
  }

  /** 只读数据快照：一次拿全量关系，不要逐条问 */
  data: {
    snapshot(options?: {
      include?: Array<'sessions' | 'agents' | 'workspaces' | 'runs'>
    }): Promise<GraphSnapshot>
  }

  /** 事件订阅（返回解绑函数） */
  events: {
    on(events: Array<EventName>, fn: (payload: unknown) => void): () => void
  }

  /** 插件私有存储（宿主负责落盘与清理，插件不碰数据目录） */
  storage: {
    get(key: string): Promise<unknown>
    set(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<void>
  }

  /** 主题 token 只读快照，用来跟随宿主观感 */
  theme: { tokens: Record<string, string> }

  /** 主进程侧能力（经宿主转发，不是直接 IPC） */
  host: {
    invoke(channel: HostChannel, payload: unknown): Promise<unknown>
  }
}

type SlotName =
  | 'sidebar.bottom'
  | 'topbar.right'
  | 'conversation.composer.dock'
  | 'conversation.message.actions'
  | 'shell.overlay'

type EventName =
  | 'session.created'
  | 'session.deleted'
  | 'run.started'
  | 'run.finished'
  | 'plan.step'
  | 'chat.done'
```

**`data.snapshot()` 的形状**（这是"会话-拓扑图"这类插件真正需要的东西）：

```ts
interface GraphSnapshot {
  sessions: Array<{
    id: string
    title: string
    agentId: string | null
    workspaceId: string | null
    state: 'idle' | 'running' | 'failed'
    updatedAt: string
  }>
  agents: Array<{ id: string; name: string; model: string | null }>
  workspaces: Array<{ id: string; path: string }>
  runs: Array<{ id: string; sessionId: string; status: string; startedAt: string }>
}
```

---

## 4. Host Context API

```ts
interface HostContext {
  tools: {
    register(def: {
      name: string
      description: string
      params: Record<string, { type: 'string' | 'number' | 'boolean'; required?: boolean }>
      sideEffect: 'none' | 'local' | 'external'
      handler(input: unknown): Promise<{ ok: boolean; value?: unknown; code?: string }>
    }): () => void
  }

  commands: { register(id: string, title: string, run: () => void | Promise<void>): () => void }

  /** 自建 IPC 通道：通道名会自动加 `plugin:<pluginId>:` 前缀，避免与其他插件/内核撞名 */
  ipc: { handle(name: string, fn: (payload: unknown) => Promise<unknown>): () => void }

  /** 订阅宿主事件（数据层级别，不是 UI 事件） */
  events: { on(event: string, fn: (payload: unknown) => void): () => void }

  log: { info(msg: string): void; warn(msg: string): void; error(msg: string): void }
}
```

主进程侧插件**可以**直接 `import` Node 内置模块（`fs`、`child_process` 等）——这与"安装即信任"一致。
但它**不许**直接写 PointStudio 的数据目录结构（会话、消息、设置集合），要经宿主 API，
否则卸载后留下孤儿数据，且我们无法做一致性校验。

---

## 5. 组件注册表与 props 契约

内置组件与插件组件挂在同一张表上，键名固定：

| 键 | 位置 | props 契约 |
| --- | --- | --- |
| `chat.bubble` | 消息气泡 | `{ role, content, streaming, failed, references, onCopy, onDelete, onResend, onReference }` |
| `chat.composer` | 输入区 | `{ draft, busy, canSend, onDraftChange, onSend, onStop }` |
| `chat.empty` | 空状态 | `{ mode, onPick }` |
| `sidebar.item` | 会话条目 | `{ conversation, active, onSelect, onRemove }` |
| `settings.section` | 设置分区 | `{ section, onChange }` |

**props 即契约。** 一旦某个键被公开，改它的 props 就是破坏性变更：

- 新增字段只能**可选**；
- 删除/改名必须升 `apiVersion`，且至少保留一个版本周期的兼容层；
- 每次改契约，同步更新本表并记入 `docs/01` 的变更说明。

---

## 6. 版本与兼容

- `pointstudio.apiVersion` 是整数，宿主启动时校验；不匹配 → 插件置为 `incompatible`，不加载、不报错崩溃。
- 宿主 API 升级时：`apiVersion` 递增，并保留上一版的适配层一个发布周期。
- 插件自己也要有 `version`（语义化），用于回滚到 `lastGoodVersion`。

---

## 7. 三条硬边界（不是权限，是保命）

1. **不许替换根节点。** 页面必须渲染在壳分配的内容区里。插件把整个 app 换掉后，用户连"禁用插件"的入口都点不到。
2. **不许自带第二份 React。** 宿主提供 React 实例；插件产物里 `react`/`react-dom` 必须外部化。自带会直接崩（hooks 抛错）。
3. **不许读写别的插件的 DOM / 样式 / 内部状态。** 需要协作就走宿主事件或共享 API。

违反 1、2 的插件在加载阶段就会被拒绝，并在插件列表里给出具体原因。

---

## 8. 崩溃与回滚（兜底，不是权限模型）

宿主保证「插件坏掉不影响主界面」：

| 触发 | 动作 |
| --- | --- |
| 页面渲染抛异常 | 该页降级为错误卡片，壳不受影响 |
| 连续 3 次异常 / 5 分钟 | 自动 `quarantined`，通知用户 |
| 启动超时 > 5s | 跳过该插件本轮加载 |
| 主进程侧未捕获异常 | 记录到崩溃日志，插件标记 degraded |
| 上次非正常退出 | 下次以「插件全禁」启动，顶栏提示并允许一键重试 |

插件状态：`enabled` / `disabled` / `quarantined` / `incompatible` / `degraded`。
设置里每个插件一行：版本、health、按钮「重置 / 回滚上一版 / 卸载」。

---

## 9. 完整示例：会话-拓扑图

**package.json**（见 §2），**renderer.js**：

```js
export default function apply(ctx) {
  ctx.pages.register({
    id: 'graph',
    title: '会话拓扑',
    icon: 'share-2',
    render(mount) {
      const canvas = document.createElement('canvas')
      mount.appendChild(canvas)
      const dispose = drawGraph(canvas)          // 插件自己的绘制逻辑

      // 实时更新：订阅而不是轮询
      const off = ctx.events.on(['run.started', 'run.finished'], () => dispose.redraw())

      return () => { off(); dispose() }           // 卸载必须清理
    }
  })
}

async function drawGraph(canvas) {
  const { sessions, agents } = await ctx.data.snapshot({ include: ['sessions', 'agents'] })
  // ……布局与绘制，全部由插件自行决定
}
```

这个例子说明：**一个"看起来很深"的功能页，只需要「批量只读 + 事件订阅 + 自己渲染」**，不需要写权限。

---

## 10. 反模式

- ❌ 在渲染进程里 `eval` / `new Function` 执行远程代码
- ❌ 插件直接读写 `userData` 下的集合文件
- ❌ 插件在 `apply` 里做阻塞初始化（超过 5s 会被跳过）
- ❌ 用全局变量存状态（卸载后残留，且与宿主生命周期不同步）
- ❌ 页面组件里直接 `fetch` 我们的 IPC 通道；一律走 `ctx.host.invoke`

---

## 11. 实现状态（重要）

| 能力 | 状态 |
| --- | --- |
| 工具注册表（副作用等级 / 参数校验 / 超时 / 审计） | ✅ 已实现（`src/main/ai/tools`） |
| MCP 客户端与注册（工具类插件的一种特例） | ✅ 已实现 |
| preload 白名单桥（`window.pointstudio`） | ✅ 已实现 |
| 应用壳（导航 + 内容区 + 路由） | ❌ 未实现 |
| 渲染层状态外置（store） | ❌ 未实现 |
| 组件注册表（内置组件走注册表） | ❌ 未实现 |
| 页面 / 插槽注册 | ❌ 未实现 |
| 插件加载器与 manifest 校验 | ❌ 未实现 |
| 崩溃隔离与插件状态机 | ❌ 未实现 |

施工顺序见 [ui-remediation.md](./ui-remediation.md)。
