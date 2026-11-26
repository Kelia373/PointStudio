# 渲染层重构、60fps 性能优化与插件底座施工单

> **状态：可执行施工单（供开发模型按步落地）。**
> 架构依据：[ADR 0007](../adr/0007-壳-路由与插件框架.md) ｜ 插件 API 规格：[plugin-development.md](./plugin-development.md)

---

## 一、施工总原则（执行模型必读）

1. **严格遵守仓库硬约束（`AGENTS.md`）**：
   - **零新增运行时依赖**：Store 用 React 19 内置 `useSyncExternalStore` 手写；图标从 `_local/icons/lucide-static/icons/` 按需拷入 `src/renderer/src/assets/icons/` 并用 `?raw` 导入。
   - **单测运行方式**：一律用 `TZ=UTC node tests/js/all.test.ts`（**严禁**用 `node --test`，本机工作区禁 spawn 子进程会报 `EPERM`）；每个新测试文件必须在 `tests/js/all.test.ts` 中挂一行 `import`。
   - **文件写入容错**：若 `edit`/`write` 工具偶发 `ReplaceFileW EIO (Win32 1175)`，用本机 Python（`C:\\Users\\Administrator\\.dsh\\dsh-runtimes\\dsh-next-primary-runtime\\dependencies\\python\\python.exe`）通过 `_local/scripts/` 下的临时脚本写入（`io.open(..., 'w', encoding='utf-8', newline='')`）。
   - **提交门禁**：每完成一个独立 Step，跑通 `tsc --noEmit` + `TZ=UTC node tests/js/all.test.ts` + `electron-vite build` + `python scripts/tdd_gate.py --all`，新增测试文件必须在提交信息里带真实的 `TDD-Red:` 变异验证记录，**严禁 `--no-verify`**。
2. **绝不破坏现有 UI 成果**：
   - 当前 `ChatPanel.tsx`（含 `.shell__top` 独立品牌条、四段式 `Sidebar.tsx`、全宽底栏 `.appbar`、全屏 `SettingsPage.tsx`、标注模式 `Annotate.tsx`、可拖拽宽度 `--content-w`）的 DOM 类名与视觉表现必须 **100% 保持不变**。

---

## 二、目标目录结构

```
src/
├── shared/types/
│   └── ipc.ts                      # [修改] 预留 RouteDecisionDto、ConversationDto.workspaceId
└── renderer/src/
    ├── runtime/
    │   ├── registry.ts             # [新增] 统一注册表（Page / Slot / Override / Router + Disposer 托管）
    │   ├── guard.tsx               # [新增] PluginErrorBoundary（报错自动回退内置组件 + 连续3次隔离）
    │   ├── SlotRenderer.tsx        # [新增] <Slot name="..." /> 与 <Overridable name="..." />
    │   ├── expose.ts               # [新增] 挂载 window.__POINTSTUDIO_RUNTIME__
    │   └── __tests__/
    │       └── registry.test.ts    # [新增] 注册、排序、覆盖、回退、一键 dispose 单测
    ├── store/
    │   ├── rafBatcher.ts           # [新增] 16ms 流式 chunk 帧合并纯逻辑（可脱离 DOM 单测）
    │   ├── studioStore.ts          # [新增] 外置响应式 Store（动静消息切片分离 + 细粒度 selector）
    │   └── __tests__/
    │       └── rafBatcher.test.ts  # [新增] 帧合并、立即 flush、取消清空单测
    └── components/                 # [修改] ChatPanel 瘦身；接入四大独家交互组件与注册表插槽
        ├── DispatchPill.tsx        # [新增] 特色1：顶栏「派遣胶囊」（Agent ⇄ Project 中途换人接力 + 驻场状态）
        ├── MemorySpark.tsx         # [新增] 特色2：「记忆闪光」提炼胶囊与输入栏幽灵记忆唤醒条
        ├── DualTrackTimeline.tsx   # [新增] 特色3：「双轨时间线」脉冲折叠轨 + 气泡内原地步骤透镜（取代纯抽屉）
        └── RouteBadge.tsx          # [新增] 特色4：Panda 协同路由战术徽章（难度 Lv.X / 胜率 / 自动升档梯队动画）
```

---

## 三、分步施工清单（Step by Step，按序执行）

### Step 1：协议槽预留（`src/shared/types/ipc.ts` + 领域层可选字段）

**目标**：为「Orca 式双轴会话（Agent ⇄ Project）」与「PandaOrchestrator 协同路由 + 升档梯队」留好纯 JSON 契约槽，遵守“只加可选字段、缺省分支有测试”的演进规则。

1. 在 `src/shared/types/ipc.ts` 中新增：
   - `EscalationStepDto` 与 `RouteDecisionDto`（完整字段见 ADR 0007 §三·特色4）；
   - `ConversationDto` 增加可选字段 `workspaceId?: string | null`；
   - `CreateConversationRequest` 增加可选字段 `assistantId?: string | null`、`workspaceId?: string | null`；
   - `MessageDto` 与 `AgentStepDetailDto` 增加可选字段 `route?: RouteDecisionDto`。
2. 在 `src/main/ai/domain/conversation.ts` 与 `src/main/services/conversationService.ts` 中：
   - `Conversation` 接口增加可选 `workspaceId?: string | null`；
   - `create()` 支持传入 `workspaceId`（缺省为 `null`），`toConversationDto` 透传 `workspaceId`。
3. **判定方式**：
   - 在 `src/main/services/__tests__/conversationService.test.ts` 补测试：创建带 `workspaceId` 的会话能原样读回，不带时兼容旧数据；
   - `tsc --noEmit` 与全部现有测试全绿。

---

### Step 2：统一注册表与 Disposer 托管（`src/renderer/src/runtime/registry.ts`）

**目标**：用一个零 React 依赖的纯 TS 类实现 `Page`、`Slot`、`Override`、`Router` 的注册、排序、快照读取、故障隔离（`quarantine`）与按 `pluginId` 一键 `disposePlugin(pluginId)`。

1. 新建 `src/renderer/src/runtime/registry.ts`，核心能力：
   - `registerPage(pluginId, def): Disposer` —— 存入 `pages` 表，按 `order ?? 100` 升序排列；
   - `registerSlot(pluginId, slotName, component, order): Disposer` —— 存入 `slots[slotName]`，按 `order ?? 100` 升序；
   - `overrideComponent(pluginId, key, component): Disposer` —— 压入 `overrides[key]` 栈顶（后注册的生效；卸载或被隔离时自动退回前一个或内置 `fallback`）；
   - `registerRouter(pluginId, routerDef): Disposer` —— 注册协同路由器（如 `auto:panda`）；
   - `reportError(pluginId, error)` —— 记录插件运行期异常时间戳；**5 分钟内满 3 次自动将该 `pluginId` 标为 `quarantined` 并触发 `disposePlugin(pluginId)`**，同时通知订阅者；
   - `disposePlugin(pluginId)` —— 逆序执行并清空该插件名下托管的所有 `Disposer`；
   - `subscribe(listener): Disposer` + `getVersion(): number` —— 供 `useSyncExternalStore` 订阅注册表变更。
2. 新建 `src/renderer/src/runtime/__tests__/registry.test.ts`（并挂入 `tests/js/all.test.ts`）：
   - 测 `registerSlot` 按 `order` 排序；
   - 测 `overrideComponent` 覆盖生效、调用 `Disposer` 后恢复为 `null`（回退内置）；
   - 测 `disposePlugin('plugin-a')` 一次性清掉该插件注册的 page、slot、override，且不影响 `'builtin'` 或 `'plugin-b'`；
   - 测 `reportError` 连续 3 次后插件自动进入 `quarantined` 且其覆盖组件被自动剥离。
3. **判定方式**：先做变异验证（注释掉 3 次报错隔离分支看测试变红，再恢复变绿），确认真红真绿。

---

### Step 3：错误自愈边界与插槽渲染器（`guard.tsx` + `SlotRenderer.tsx` + `expose.ts`）

**目标**：让任何插件的 UI 崩溃只降级它自己，绝不白屏。

1. 新建 `src/renderer/src/runtime/guard.tsx`：
   - 实现 React Class 组件 `PluginErrorBoundary`，接收 `{ pluginId: string; fallback?: ReactNode; onError?: (err: Error) => void; children: ReactNode }`；
   - `componentDidCatch(error)` 调用 `registry.reportError(pluginId, error)`；
   - 若有 `fallback`（比如 `<Overridable>` 的内置组件），报错当场渲染 `fallback`。
2. 新建 `src/renderer/src/runtime/SlotRenderer.tsx`：
   - `<Slot name="chat.composer.toolbar" props={...} />`：用 `useSyncExternalStore` 订阅 `registry`，遍历该 slot 下的所有条目，每一项外面包 `<PluginErrorBoundary pluginId={entry.pluginId} fallback={null}>`；
   - `<Overridable name="chat.bubble" fallback={BuiltinMessageBubble} props={...} />`：若 `registry.getOverride(name)` 存在，则用 `<PluginErrorBoundary pluginId={override.pluginId} fallback={<Builtin {...props} />}>` 渲染覆盖组件；否则直接渲染 `<Builtin {...props} />`。
3. 新建 `src/renderer/src/runtime/expose.ts`：
   - 将 `{ React, ReactDOM, jsxRuntime, registry }` 挂到 `window.__POINTSTUDIO_RUNTIME__`，在 `main.tsx` 首行调用。
4. **判定方式**：`tsc --noEmit` 通过，`electron-vite build` 产物正常。

---

### Step 4：60fps 流式帧合并器与外置 Store（`rafBatcher.ts` + `studioStore.ts`）

**目标**：消除流式输出时每秒几十次全列表重绘的卡顿，并把状态从 `ChatPanel` 抽出来供壳和插件共用。

1. 新建 `src/renderer/src/store/rafBatcher.ts`（纯 TS，注入 `schedule: (cb: () => void) => unknown` 默认用 `requestAnimationFrame`，测试时可注入受控 fake scheduler）：
   - `push(id: string, chunk: string): void`：将同一个 `id` 在当前帧内的多个 `chunk` 字符串直接拼接到缓冲区，若尚未预约下一帧则调一次 `schedule`；
   - 帧回调触发时一次性调用 `onFlush(batchedMap)` 并清空缓冲区；
   - `flushNow()`：在收到 `chat:done` 或 `chat:error` 时立即同步冲刷残余缓冲，防止最后几个字迟到；
   - `clear(id)`：取消时丢弃缓冲。
2. 新建 `src/renderer/src/store/__tests__/rafBatcher.test.ts`（挂入 `tests/js/all.test.ts`）：
   - 测同一帧内连续 `push` 10 个 chunk，只触发 **1 次** `onFlush` 且内容完整拼接；
   - 测 `flushNow()` 立即同步冲刷且后续帧不再重复触发；
   - 做变异验证拿 `TDD-Red`。
3. 新建 `src/renderer/src/store/studioStore.ts`：
   - 持有状态切片：
     - `conversations`, `activeId`, `assistants`, `provider`, `mcpConnections`
     - **动静分离的消息切片**：`historyMessages: UiMessage[]`（已完成的历史消息）与 `inflightMessage: UiMessage | null`（正在流式吐字的那一条）；
     - `busy`, `inflightId`, `mode`, `lastRunMs`, `planRun`, `activePage: 'chat' | 'settings' | string`
     - `lastRouteDecision: RouteDecisionDto | null`
   - 导出 `useStudioSlice<T>(selector: (state: StudioState) => T, isEqual?: (a: T, b: T) => boolean): T`。
4. 在 `src/renderer/src/styles/app.css` 的 `.msg` 规则上增加：
   ```css
   content-visibility: auto;
   contain-intrinsic-size: 0 88px;
   ```

---

### Step 5：内置组件入表、插槽落位与 `ChatPanel` 瘦身

**目标**：把 `ChatPanel.tsx` 接入 `studioStore` 与 `SlotRenderer`，实现**细粒度订阅与渲染隔离**（流式吐字时历史消息与侧栏 0 重绘，不以文件行数作为考核指标），10 个插槽与 5 个 `<Overridable>` 全部就位。

1. 在 `ChatPanel.tsx` / `Sidebar.tsx` / `Composer.tsx` / `MessageBubble.tsx` 中埋入 `<Slot>` 与 `<Overridable>`：
   - 消息气泡用 `<Overridable name="chat.bubble" fallback={MessageBubble} props={...} />` 渲染，内部操作栏末尾挂 `<Slot name="chat.message.actions" ... />`；
   - 输入区用 `<Overridable name="chat.composer" fallback={Composer} props={...} />` 渲染，`Composer` 底部栏挂 `<Slot name="chat.composer.toolbar" ... />`；
   - 空状态用 `<Overridable name="chat.empty" fallback={EmptyState} props={...} />`；
   - 检查器用 `<Overridable name="chat.inspector" fallback={Inspector} props={...} />`；
   - 顶栏右侧挂 `<Slot name="topbar.right" ... />`；
   - 底栏 `.appbar` 左端挂 `<Slot name="appbar.left" ... />`，右端挂 `<Slot name="appbar.right" ... />`；
   - 侧栏 `FEATURES` 改为读取 `registry.getPages()`，并在各段挂好 `sidebar.features`、`sidebar.agents.header`、`sidebar.projects.header`、`sidebar.bottom`。
2. 当 `activePage !== 'chat'` 且匹配到 `registry.getPage(activePage)` 时，主舞台中央渲染该插件/内置页面（外包 `PluginErrorBoundary`），顶栏/侧栏/底栏保持不断裂。

---

### Step 6：主进程 `JsonFileStore` 内存缓存与 200ms 合并落盘（性能优化）

**目标**：消除每次切换模型、追加消息时的同步磁盘写等待。

1. 在 `src/main/data/fileStore.ts` 中：
   - 首次 `readAll()` 后驻留内存副本 `cache: T[] | null`；
   - `writeAll(items)` 立即更新内存 `cache`，并启动 200ms 尾部合并写盘定时器（若已在写盘则排队合并）；
   - 提供 `flush(): Promise<void>` 方法，在 `src/main/index.ts` 的 `before-quit` 中调用，确保退出零丢数；
   - 测试环境（或传入 `{ immediate: true }`）支持立即落盘以便断言磁盘文件。

---

## 三（续）、四大独家交互 UI 开发施工单（Step 7 ~ Step 10）

> **说明**：Step 1 ~ Step 6 完成底座与 60fps 提速后，开发 Agent 必须继续按以下 **Step 7 ~ Step 10** 落地 PointStudio 的四大标志性交互 UI。所有新增 UI 必须严守 `tokens.css` 黑白单色基线（仅状态点/徽标可用 `--ok` / `--warn` / `--danger` 语义色，严禁裸色值与裸毫秒）。

### Step 7：特色交互 1 ——「驻场工位（Agent Bench）」双轴侧栏 + 顶栏「派遣胶囊（Dispatch Pill）」

**目标**：打破传统死板的文件树，实现「按 Agent / 按 Project 双轴过滤会话」以及「同一会话现场中途换 Agent 接力」。

1. **纯函数与单测（`src/renderer/src/lib/dispatchFilter.ts` + `__tests__/dispatchFilter.test.ts`）**：
   - 实现 `filterSessionsByAxis(sessions: ConversationDto[], filter: { agentId?: string | null; workspaceId?: string | null | 'unmounted'; keyword?: string }): ConversationDto[]`：
     - 当选中侧栏某个 Agent 时，过滤出 `session.assistantId === agentId` 的跨项目执行记录；
     - 当选中某个 Project 时，过滤出 `session.workspaceId === workspaceId` 的跨 Agent 记录；
     - `'unmounted'` 过滤出 `workspaceId == null` 的随手聊（主聊天/临时会话）；
   - 实现 `computeAgentBenchStatus(agentId: string, sessions: ConversationDto[], inflightSessionId: string | null): { state: 'idle' | 'working'; activeCount: number; lastTitle: string | null }`，供侧栏 Agent 工位显示活体驻场状态（如 `空闲待命` / `执行中 · 动效素材清单`）。
   - 挂入 `tests/js/all.test.ts` 并完成变异验证（`TDD-Red`）。
2. **侧栏「驻场工位」与双轴联动（修改 `src/renderer/src/components/Sidebar.tsx`）**：
   - 第三段「Agent」列表不再只是点开管理抽屉：
     - 点击某位 Agent 行 = 激活该 Agent 视角（高亮选中态 `.side__row--active`），下方会话列表即时切换为该 Agent 的执行记录；再次点击取消过滤；
     - 每位 Agent 右侧显示驻场状态微标（空闲圆点 / 脉冲执行中圆点 + 会话计数），悬浮或点右侧管理图标才打开 `AssistantPanel` 抽屉；
   - 第四段「Project」顶部固定一行「主聊天（未挂载项目）」，下方列出工作区项目 + 当前过滤出的会话条目，每条会话右侧带当前负责的 Agent 首字微标。
3. **顶栏「派遣胶囊」（新建 `src/renderer/src/components/DispatchPill.tsx` 并挂载到 `ChatPanel.tsx` 顶栏）**：
   - 取代顶栏原有的原生 `<select>` 助手下拉，渲染组合胶囊 `.dispatch-pill`：
     `[ 👤 {Agent名 / 裸聊}  ⇄  📁 {项目名 / 临时会话}  ·  ⚡ {模式/耗时} ]`
   - 点击左半区（Agent 段）：弹出轻量级 Popover 列表，选中新 Agent 后立即调用 `conversations.setAssistant(activeId, newAgentId)` 实现**同一会话中途换人接力**，并在消息流中插入一条轻量系统分隔提示（`已交接给 {Agent名} 继续处理`）；
   - 点击右半区（Project 段）：弹出工作区项目选择 Popover（或打开工作区面板），切换当前会话挂载的 `workspaceId`。

---

### Step 8：特色交互 2 ——「记忆闪光（Memory Spark）」私域记忆提炼与唤醒条

**目标**：让“培养 Agent”肉眼可见——对话中产生纠正或阶段结论时可一键钉入 Agent 脑海，提问时能看到唤醒了哪些私域记忆。

1. **纯函数与单测（`src/renderer/src/lib/memorySpark.ts` + `__tests__/memorySpark.test.ts`）**：
   - 数据结构（先在前端 `localStorage` + Store 闭环，键名 `pointstudio.agentMemories.v1`，结构满足纯 JSON 以便后续迁主进程/Rust）：
     ```ts
     export interface AgentMemoryItem {
       id: string
       agentId: string
       scope: 'global' | `project:${string}`
       text: string
       sourceSessionId: string
       locked: boolean
       createdAt: string
     }
     ```
   - 实现 `detectMemoryCandidate(userText: string, assistantText: string): { suggestedText: string; defaultScope: 'global' | 'project' } | null`：
     - 当用户消息含规则/纠正信号（如“以后”“记住”“不要”“一律”“约定”“规范”）或助手消息含明确结论摘要时，提炼出 ≤80 字的候选记忆摘要；
   - 实现 `matchActiveMemories(memories: AgentMemoryItem[], agentId: string | null, workspaceId: string | null, draft: string): AgentMemoryItem[]`：
     - 按 `agentId` + 作用域（`global` 或匹配当前 `project:${workspaceId}`）过滤出当前生效的记忆（最多展示 3 条）。
   - 挂入 `tests/js/all.test.ts` 并做变异验证。
2. **气泡旁「记忆闪光」微件（新建 `src/renderer/src/components/MemorySpark.tsx`，通过 `chat.message.actions` 插槽或 `MessageBubble` 挂载）**：
   - 在符合候选条件的回答气泡操作栏旁（或任意助手气泡悬停时），展示微光胶囊按钮 `.spark-btn`：`✦ 钉入记忆`；
   - 点击后原地展开迷你确认条：可编辑一句话文本 + 切换 `[全局 | 仅本项目]` + `[确认钉入]`；
   - 钉入成功后按钮变为 `✦ 已记住（全局/项目）`（带 `--ok` 绿点反馈），侧栏对应 Agent 的记忆计数 `+1`。
3. **输入栏上方「幽灵记忆唤醒条」（挂载到 `chat.composer.toolbar` 或 `chat.banner` 插槽）**：
   - 当当前会话绑定的 Agent 有生效记忆时，在输入框上方渲染一行极克制的幽灵条 `.memory-wake-bar`：
     `✦ 已唤醒 {Agent名} 的 {N} 条私域记忆：{摘要1} · {摘要2}  [管理] [本轮忽略 ×]`
   - 点 `[管理]` 在右侧检查器或抽屉中列出该 Agent 的全部记忆（支持查看、改字、锁死 `locked`、删除）。

---

### Step 9：特色交互 3 ——「双轨时间线（Dual-Track Stream）」+ 气泡内原地透镜（In-place Lens）

**目标**：解决多步计划与工具调用要么刷屏、要么弹抽屉遮挡视线的问题，实现「主轨看结论、侧轨点开原地看步骤透镜」。

1. **纯函数与单测（`src/renderer/src/lib/timelineLens.ts` + `__tests__/timelineLens.test.ts`）**：
   - 实现 `summarizePlanTrack(planRun: PlanRunState): { headline: string; totalDurationMs: number; toolCount: number; statusTone: 'running' | 'ok' | 'warn' | 'danger'; needsConfirmCount: number }`：
     - 例如产出 `"4 步已完成 · 调 3 工具 · 1.8s"` 或 `"停在第 2 步：等待高风险确认"`；
   - 挂入 `tests/js/all.test.ts` 并做变异验证。
2. **双轨时间线组件（新建 `src/renderer/src/components/DualTrackTimeline.tsx`）**：
   - 直接嵌入在消息流 `.stream__inner` 内部（紧跟触发该计划的会话轮次，**不再默认弹出遮挡右侧检查器的 `.drawer` 全屏遮罩**！）：
   - **简略态（默认折叠）**：一条紧凑的横向脉冲卡片 `.track-pill`：
     - 左侧状态指示点（运行中脉冲动画 / 完成 `--ok` / 需确认 `--warn` / 失败 `--danger`）；
     - 中间显示 `summarizePlanTrack` 产出的汇总文案与目标名；
     - 若处于 `stopped`（需确认高风险步骤），直接在胶囊右侧显示醒目的 `[确认并继续]` 按钮；
     - 右侧 `[ 展开透镜 ▾ ]` 切换按钮。
   - **展开态（原地透镜 In-place Lens）**：
     - 在消息流内原地平滑展开（`--dur-3`）步骤网格列表 `.lens-steps`；
     - 每一步显示：序号、动作描述 `step.action`、工具胶囊 `step.tool ?? '思考'`、风险标签、耗时 `durationMs`、失败错误码或产出摘要；
     - 顶部附带 `[在右侧检查器固定]` 按钮，满足需要边看长文边盯进度的场景。

---

### Step 10：特色交互 4 —— PandaOrchestrator 协同路由战术徽章与「失败自动升档（Escalation）」UI

**目标**：把 31MB 本地决策模型的「难度画像 + 性价比首发 + 失败自动升档梯队」直观呈现在输入栏与消息气泡上，并内置一个零外部依赖的本地启发式协同路由器（`HeuristicPandaRouter`）作为默认离线实现，同时支持无缝切换外部 PandaOrchestrator HTTP/MCP 服务。

1. **内置离线协同路由器与单测（`src/renderer/src/lib/pandaRouter.ts` + `__tests__/pandaRouter.test.ts`）**：
   - 实现 `profileAndRoute(prompt: string, availableModels: string[], previousFailedModels?: string[]): RouteDecisionDto`：
     - **任务画像（Profiler）**：根据 prompt 长度、代码块/报错堆栈特征、关键词（架构/重构/并发/安全 vs 翻译/改短/格式）在 1ms 内算出 `difficulty.level`（1~10）与 `difficulty.category`（`implementation` | `debugging` | `architecture` | `explanation`）；
     - **阶梯生成（Escalation Ladder）**：按难度排序候选梯队（例如低难度首发轻量快模型 `deepseek-chat` / `qwen2.5`，高难度或上一棒在 `previousFailedModels` 中失败时，**自动沿阶梯升档**到下一棒 `deepseek-reasoner` 并标记 `attempt: 2, escalatedFrom: 'deepseek-chat'`）；
   - 将该路由器通过 `registry.registerRouter('builtin', { id: 'auto:panda', label: '🐼 Auto · 协同路由', ... })` 默认注册进系统；当外部 PandaOrchestrator 插件加载时可覆盖或接管；
   - 挂入 `tests/js/all.test.ts` 并做变异验证（断言：简单问题派首发快模型；传入 `previousFailedModels: ['deepseek-chat']` 时自动升档到梯队下一棒且 `attempt === 2`）。
2. **输入栏与气泡「路由战术徽章」（新建 `src/renderer/src/components/RouteBadge.tsx`）**：
   - **输入栏模型下拉**：当 `registry.getRouters()` 非空时，在 `Composer.tsx` 的模型选择器顶部置顶显示 `🐼 Auto · 协同路由`；
   - **输入栏实时预判（挂载于 `chat.composer.toolbar` 插槽）**：当用户选中 `🐼 Auto · 协同路由` 且输入框有内容时，实时显示紧凑战术预览：
     `[ 🐼 Lv.{level} {类别} ➔ 首发 {chosenModel} (预估胜率 {XX}%) ｜ 升档梯队: {model1} ▸ {model2} ]`
   - **气泡头部路由与升档勋章（挂载于 `MessageBubble.tsx` 的 `.msg__head`）**：
     - 若该消息带有 `route?: RouteDecisionDto`，在消息头部时间旁渲染路由胶囊；
     - 若 `route.escalatedFrom` 存在（代表发生了失败自动升档），渲染醒目的升档轨迹标签：
       `[ ⚡ 已由 {escalatedFrom} 自动升档至 {chosenModel} (第 {attempt} 棒) ]`
   - **气泡操作栏「升档重试」按钮**：在助手消息的悬停操作栏里，若当前消息的 `route.escalationLadder` 还有下一棒模型，提供 `[ ⚡ 升档重试 ]` 按钮——点击后直接按梯队下一棒强模型重新请求本轮回答！

---

## 四、总验收清单（DoD）

执行模型交付前必须逐条核对并贴出命令输出：

- [ ] `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 零报错
- [ ] `TZ=UTC node tests/js/all.test.ts` 全绿（新增 `registry.test.ts` 与 `rafBatcher.test.ts` 均做过变异验证）
- [ ] `node node_modules/electron-vite/bin/electron-vite.js build` 构建成功
- [ ] `node scripts/gen-doc-index.mjs --check` 文档索引检查通过
- [ ] `C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\python\python.exe scripts/tdd_gate.py --all` 门禁通过
- [ ] `window.__POINTSTUDIO_RUNTIME__` 在渲染层挂载成功，5 个 `<Overridable>` 与 10 个 `<Slot>` 在 DOM/组件树中真实生效
- [ ] **Step 7（驻场工位 & 派遣胶囊）**：侧栏点 Agent / Project 可双轴过滤会话，顶栏 `DispatchPill` 支持同一会话中途换 Agent 接力（`dispatchFilter.test.ts` 全绿）
- [ ] **Step 8（记忆闪光）**：回答气泡可点 `✦ 钉入记忆`（分全局/仅本项目），输入框上方显示已唤醒的私域记忆幽灵条（`memorySpark.test.ts` 全绿）
- [ ] **Step 9（双轨时间线 & 原地透镜）**：跑计划时在消息流内渲染 `.track-pill` 脉冲折叠条，点击可在气泡流内原地展开步骤透镜，不再强弹遮罩挡检查器（`timelineLens.test.ts` 全绿）
- [ ] **Step 10（Panda 协同路由 & 自动升档 UI）**：输入栏可选 `🐼 Auto · 协同路由` 并实时显示难度 Lv.X 与升档梯队徽章，消息支持 `[ ⚡ 升档重试 ]` 沿梯队换强模型（`pandaRouter.test.ts` 全绿）
- [ ] 现有界面视觉、四段式侧栏、全宽底栏、全屏设置页、标注模式（`ANNOTATE` 开关）零回退
