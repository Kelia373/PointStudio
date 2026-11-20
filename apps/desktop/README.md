# apps/desktop

**职责**：个人版外壳。Electron 主进程 / 渲染进程 / 预加载，负责启动、组装依赖、把 `packages/*` 接起来。

**只做三件事**：装配（选哪个 provider / 哪个 policy 实现）、进程与窗口管理、平台集成（托盘、快捷键、更新）。

**禁止**：

- 禁止写业务逻辑——逻辑属于 `packages/core`；
- 禁止绕过 `policy` 直接放行能力。

**形态**：本地优先、离线可用、单用户（`tenantId = 'local'`）。

**现状**：M0 骨架已落地（2026-11-21）——窗口能开、能构建、类型检查通过。目录约定：

```
src/main/index.ts        主进程：建窗、加载页面、平台生命周期
src/preload/index.ts     预加载：renderer 与 main 之间唯一的白名单桥
src/renderer/index.html  renderer 入口（临时内联基础样式，接 Tailwind 时整块替换）
src/renderer/src/        React 应用
electron.vite.config.ts  唯一构建配置
```

```bash
./node_modules/.bin/electron-vite dev     # 开窗口（需先 unset ELECTRON_RUN_AS_NODE，见根 AGENTS.md）
./node_modules/.bin/electron-vite build   # 产物在 out/
./node_modules/.bin/tsc --noEmit          # 类型检查
```

依据 [ADR 0002](../../docs/adr/0002-技术栈选型与双版本架构.md)、[ADR 0004](../../docs/adr/0004-M0工程骨架与首批依赖.md)。
