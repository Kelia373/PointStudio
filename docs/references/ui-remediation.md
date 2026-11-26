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
    └── components/                 # [修改] ChatPanel 瘦身；Sidebar/Composer/MessageBubble 等接入注册表与插槽
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

**目标**：把 `ChatPanel.tsx` 接入 `studioStore` 与 `SlotRenderer`，行数压到 ≤450 行，10 个插槽与 5 个 `<Overridable>` 全部就位。

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

## 四、总验收清单（DoD）

执行模型交付前必须逐条核对并贴出命令输出：

- [ ] `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` 零报错
- [ ] `TZ=UTC node tests/js/all.test.ts` 全绿（新增 `registry.test.ts` 与 `rafBatcher.test.ts` 均做过变异验证）
- [ ] `node node_modules/electron-vite/bin/electron-vite.js build` 构建成功
- [ ] `node scripts/gen-doc-index.mjs --check` 文档索引检查通过
- [ ] `C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\python\python.exe scripts/tdd_gate.py --all` 门禁通过
- [ ] `window.__POINTSTUDIO_RUNTIME__` 在渲染层挂载成功，5 个 `<Overridable>` 与 10 个 `<Slot>` 在 DOM/组件树中真实生效
- [ ] 现有界面视觉、四段式侧栏、全宽底栏、全屏设置页、标注模式（`ANNOTATE` 开关）零回退
