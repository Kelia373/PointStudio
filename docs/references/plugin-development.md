# PointStudio 插件开发指南（架构规格）

> **状态：设计规格（P0 底座落地中）。**
> 总体架构决策见 [ADR 0007](../adr/0007-壳-路由与插件框架.md)，渲染层改造步骤见 [ui-remediation.md](./ui-remediation.md)。

---

## 1. 设计哲学：全权开放 + 宿主自愈

PointStudio 的插件体系参考 DSH 的双端整合思路，遵循两条基本原则：

1. **安装即信任，能力不阉割**：插件一旦由用户启用，即可在渲染层注册整页功能、往任意插槽塞微件、**直接替换客户端内置组件**、读取并订阅全量 Store 状态、调用主进程桥以及注入自定义协同路由器（如 PandaOrchestrator）。
2. **故障绝不陪葬**：插件注册的一切资源（UI、样式、事件、路由器）全部返回 `Disposer` 并由宿主强制托管。插件组件若在渲染时抛错，宿主的 `PluginErrorBoundary` 会**当场将其无缝回退为内置默认组件**；连续报错自动隔离（`quarantined`）；启动死锁由主进程 `boot.lock` 看门狗自动切入安全模式（Safe Mode）。

---

## 2. 插件包（Bundle）目录结构

一个插件是一个独立目录（开发期可放在本地 `plugins/<plugin-id>/`，或用户数据目录 `userData/plugins/<plugin-id>/`）：

```
pointstudio-plugin-panda-router/
├── package.json          # 插件清单（含 pointstudio 字段）
├── renderer.js           # 渲染进程入口：导出 apply(ctx)
├── main.js               # 主进程入口（可选）：导出 apply(hostCtx)
├── icon.svg              # 插件图标（24x24 线条 SVG）
└── README.md
```

### `package.json` 清单规范

```json
{
  "name": "pointstudio-plugin-panda-router",
  "version": "1.0.0",
  "pointstudio": {
    "apiVersion": 1,
    "displayName": "Panda 协同路由",
    "description": "31MB 本地任务画像 + 模型能力卡匹配 + 失败自动升档梯队",
    "renderer": "./renderer.js",
    "main": "./main.js",
    "icon": "./icon.svg",
    "contributes": {
      "pages": [
        { "id": "panda.studio", "title": "协同路由看板", "icon": "compass", "order": 15 }
      ]
    }
  }
}
```

---

## 3. 共享运行时（严禁自带第二份 React）

插件在渲染进程中与宿主共用同一个 React 实例。宿主在启动时将运行时挂载到全局：

```ts
// window.__POINTSTUDIO_RUNTIME__
interface PointStudioRuntime {
  React: typeof import('react')
  ReactDOM: typeof import('react-dom/client')
  jsxRuntime: typeof import('react/jsx-runtime')
}
```

- 插件构建时**必须**将 `react`、`react-dom`、`react/jsx-runtime` 指向 `window.__POINTSTUDIO_RUNTIME__`，不得把第二份 React 打包进 `renderer.js`（否则 Hooks 会立刻报错并被宿主 `PluginErrorBoundary` 拦截隔离）。
- 样式必须优先使用宿主 `tokens.css` 中的 CSS 变量（`--bg`、`--panel`、`--fg`、`--line`、`--rad-ctl`、`--dur-2` 等），天然兼容深浅双主题。

---

## 4. 渲染层插件上下文（`RendererPluginContext`）

`renderer.js` 默认导出 `export default function apply(ctx: RendererPluginContext): void | Disposer`：

```ts
export type Disposer = () => void

export interface RendererPluginContext {
  readonly pluginId: string

  /** 1. UI 扩展：整页、插槽、内置组件覆盖、样式注入 */
  ui: {
    /** 注册独立功能页（自动出现在侧栏「关键功能」区，点击后在主舞台中央渲染） */
    registerPage(def: {
      id: string
      title: string
      icon?: string
      order?: number
      defaultPinned?: boolean
      component: React.ComponentType<{ navigate: (pageId: string) => void }>
    }): Disposer

    /** 往客户端预留的 10 个插槽之一塞入组件（按 order 升序排列） */
    registerSlot<S extends SlotName>(
      slot: S,
      component: React.ComponentType<SlotPropsMap[S]>,
      order?: number
    ): Disposer

    /** 直接替换客户端内置的核心组件（若渲染抛错，宿主自动回退为内置实现） */
    overrideComponent<K extends OverrideKey>(
      key: K,
      component: React.ComponentType<OverridePropsMap[K]>
    ): Disposer

    /** 注入插件专属 CSS（禁用插件时宿主自动移除对应 <style> 标签） */
    injectStyle(cssText: string): Disposer
  }

  /** 2. 响应式 Store：批量只读快照 + 细粒度订阅 + 业务动作 */
  store: {
    getSnapshot(): StudioSnapshot
    subscribe(listener: (snapshot: StudioSnapshot) => void): Disposer
    actions: {
      selectSession(sessionId: string): void
      createSession(input?: { title?: string; assistantId?: string | null; workspaceId?: string | null }): Promise<void>
      setSessionModel(sessionId: string, patch: { model?: string | null; maxTokens?: number }): Promise<void>
      sendMessage(text: string): Promise<void>
      runPlan(goal: string): Promise<void>
      navigatePage(pageId: 'chat' | 'settings' | string): void
    }
  }

  /** 3. 协同模型路由扩展槽（专为 PandaOrchestrator 等路由器设计） */
  routing: {
    /** 注册虚拟模型档位（如 "auto:panda"）及发送前的路由决策钩子 */
    registerRouter(def: {
      id: string
      label: string                  // 显示在输入栏模型下拉中，如 "🐼 Auto · 协同路由"
      decide(input: {
        prompt: string
        sessionId: string
        assistantId: string | null
        workspaceId: string | null
        stepIndex?: number
        previousFailedModels?: string[]
      }): Promise<RouteDecisionDto>
      onOutcome?(traceId: string, outcome: {
        ok: boolean
        model: string
        durationMs: number
        retried: boolean
        aborted: boolean
      }): void | Promise<void>
    }): Disposer
  }

  /** 4. 插件私有 KV 存储（由宿主隔离落盘，不污染主库） */
  storage: {
    get<T = unknown>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
    remove(key: string): Promise<void>
  }

  /** 5. 直通底层 IPC 桥 */
  bridge: PointStudioApi
}
```

---

## 5. 插槽清单（10 个 `SlotName`）与覆盖键（5 个 `OverrideKey`）

### 5.1 预留插槽（追加型 `<Slot>`）

| 插槽名 (`SlotName`) | 界面位置 | 传入的 Props (`SlotPropsMap[S]`) | 典型用途 |
| --- | --- | --- | --- |
| `sidebar.features` | 侧栏第二段「关键功能」区 | `{ activePage: string; navigate: (id: string) => void }` | `registerPage` 会自动挂入此处；也可手动加快捷动作项 |
| `sidebar.agents.header` | 侧栏第三段「Agent」标题右侧 | `{ count: number }` | 导入 Agent、批量装备按钮 |
| `sidebar.projects.header` | 侧栏第四段「Project」标题右侧 | `{ count: number }` | 切换分组视图（按项目 / 按人）、批量清理 |
| `sidebar.bottom` | 侧栏最底部 | `{}` | 插件快捷开关或驻场状态摘要 |
| `topbar.right` | 主区顶栏右侧图标区（检查器键左侧） | `{ sessionId: string | null }` | 顶栏全局小工具开关 |
| `appbar.left` | 底部全宽状态栏左端 | `{ mode: 'live' | 'local' | null; busy: boolean }` | 引擎连接状态灯、Panda 路由器在线状态 |
| `appbar.right` | 底部全宽状态栏右端 | `{}` | Token 累计花费、本地模型负载、版本号 |
| `chat.banner` | 消息流上方通知区 | `{ sessionId: string | null }` | 会话级状态横幅、唤醒的私域记忆提示条 |
| `chat.composer.toolbar` | 输入栏左下角（模型与思考等级右侧） | `{ draft: string; busy: boolean; sessionId: string | null }` | **Panda 路由实时难度/胜率徽章**、快捷指令选择 |
| `chat.message.actions` | 每条消息气泡的悬停操作栏 | `{ message: UiMessage; sessionId: string }` | 「✦ 提炼为私域记忆」、按升档阶梯换强模型重试 |
| `shell.overlay` | 全局顶层浮层（与抽屉同级） | `{}` | `⌘K` 命令面板、全局快捷键浮窗 |

### 5.2 可替换内置组件（覆盖型 `<Overridable>`）

**契约铁律**：以下 5 个键的 Props 一旦公开即为跨版本契约，宿主只能新增可选字段，禁止删改既有字段。

| 覆盖键 (`OverrideKey`) | 默认内置组件 | 传入的 Props (`OverridePropsMap[K]`) |
| --- | --- | --- |
| `chat.bubble` | `MessageBubble.tsx` | `{ role, content, streaming, failed, references, route, at, index, onCopy, onDelete, onResend, onReference }` |
| `chat.composer` | `Composer.tsx` | `{ draft, busy, canSend, model, models, effort, routePreview, onDraftChange, onSend, onStop, onPlan, onModelChange, onEffortChange }` |
| `chat.empty` | `EmptyState.tsx` | `{ mode, onPick }` |
| `chat.inspector` | `Inspector.tsx` | `{ tab, onTab, collapsed, conversationTitle, assistantName, mode, messageCount, referenceCount, provider, effectiveModel, effectiveMaxTokens, modelFromSession, lastRunMs, planRun, mcpConnections, onOpenPlan, onConfirmPlan }` |
| `sidebar.sessionItem` | `Sidebar.tsx` 单行 | `{ conversation, active, onSelect, onRemove }` |

---

## 6. 两个标杆插件示例

### 示例 A：「会话 - Agent - 项目」网络调度拓扑图

```tsx
// pointstudio-plugin-topology/renderer.js
export default function apply(ctx) {
  const { React } = window.__POINTSTUDIO_RUNTIME__

  function TopologyPage() {
    const [snap, setSnap] = React.useState(() => ctx.store.getSnapshot())
    React.useEffect(() => ctx.store.subscribe(setSnap), [])

    // 直接用 snap.conversations, snap.assistants, snap.planRun 画出节点与派遣连线
    return React.createElement('div', { className: 'topology-stage' },
      `当前驻场 Agent: ${snap.assistants.length} · 活跃会话: ${snap.conversations.length}`
    )
  }

  ctx.ui.registerPage({
    id: 'topology',
    title: '调度拓扑',
    icon: 'compass',
    order: 10,
    defaultPinned: true,
    component: TopologyPage
  })
}
```

### 示例 B：接入 PandaOrchestrator（31MB 本地协同路由 + 失败升档阶梯）

```tsx
// pointstudio-plugin-panda-router/renderer.js
export default function apply(ctx) {
  const { React } = window.__POINTSTUDIO_RUNTIME__

  // 1. 注册协同路由器：输入栏模型下拉自动多出「🐼 Auto · 协同路由」
  ctx.routing.registerRouter({
    id: 'auto:panda',
    label: '🐼 Auto · 协同路由',
    async decide({ prompt, previousFailedModels = [] }) {
      // 调用本地 PandaOrchestrator HTTP 服务 (127.0.0.1:8787/route) 或 MCP
      const res = await fetch('http://127.0.0.1:8787/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, exclude_models: previousFailedModels })
      }).then(r => r.json())

      return {
        traceId: res.trace_id,
        chosenModel: res.choice.model_id,
        decidedBy: res.choice.decided_by,
        confidence: res.choice.confidence,
        difficulty: { level: res.difficulty.level, category: res.category.label },
        estCostUsd: res.ranking?.[0]?.est_cost_usd,
        escalationLadder: res.escalation_ladder?.map(step => ({
          model: step.model_id,
          pSuccess: step.p_success,
          estCostUsd: step.est_cost_usd
        }))
      }
    },
    async onOutcome(traceId, outcome) {
      // 把 L1 真实成败、重发、耗时回喂给 Panda Router 拟合本地能力卡
      await fetch('http://127.0.0.1:8787/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trace_id: traceId, ...outcome })
      }).catch(() => {})
    }
  })

  // 2. 在输入栏工具条挂一枚实时难度/升档梯队徽章
  ctx.ui.registerSlot('chat.composer.toolbar', ({ sessionId }) => {
    const snap = ctx.store.getSnapshot()
    if (!snap.lastRouteDecision) return null
    const d = snap.lastRouteDecision
    return React.createElement('span', { className: 'chip' },
      `🐼 Lv.${d.difficulty.level} ${d.difficulty.category} ➔ ${d.chosenModel} (${Math.round(d.confidence * 100)}%)`
    )
  })
}
```

---

## 7. 三条硬底线（违反即被加载器拒绝或隔离）

1. **禁止篡改 `#root` 容器本身**：所有页面必须经 `registerPage` 在主舞台内渲染，保留顶栏与设置页入口，确保用户永远有路可退、有处可关。
2. **禁止打包第二份 React**：必须复用 `window.__POINTSTUDIO_RUNTIME__.React`。
3. **禁止绕过 `src/shared/types/ipc.ts` 传递非 JSON 对象**：为保证将来客户端无缝切换到 Rust 底座，一切跨进程载荷必须是纯 JSON。
