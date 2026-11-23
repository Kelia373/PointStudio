# src

**职责**：源码根。桌面壳（Electron 三进程）+ 与外壳无关的内核包。

## 布局

```
src/
├── main/          主进程：入口 index.ts（组合根）+ 内核目录
│   ├── core/      应用运行时（生命周期/DI、路径、日志、窗口、调度）
│   ├── ipc/       主↔渲染边界
│   ├── data/      数据层
│   ├── ai/        核心域（domain / providers / tools / agent）
│   ├── features/  services/  utils/  i18n/
│   └── policy/  remote/  ui/
├── preload/       预加载：renderer 与 main 之间唯一的白名单桥
└── renderer/      渲染进程（React）
```

内核目录的职责与依赖方向见 [main-architecture.md](../docs/references/architecture/main-architecture.md)。

## 桌面壳只做三件事

1. **装配**：选哪个 provider、哪个 policy 实现，把 `main/` 下的内核目录接起来
2. **进程与窗口管理**
3. **平台集成**：托盘、快捷键、更新

## 禁止

- 禁止写业务逻辑——逻辑属于 `main/ai`
- 禁止绕过 `policy` 直接放行能力
- 禁止在 `main/` 里写可复用的纯逻辑——那属于 `main/` 下的内核目录

## 命令

```bash
./node_modules/.bin/electron-vite dev     # 开窗口（需先 unset ELECTRON_RUN_AS_NODE，见根 AGENTS.md）
./node_modules/.bin/electron-vite build   # 产物在 out/
./node_modules/.bin/tsc --noEmit          # 类型检查
```

依赖装在工作区外的 `D:\deveTools\ps-node`，本目录的 `node_modules` 是指向它的链接——**不要在仓库内直接 `pnpm install`**，见根 `AGENTS.md`。

依据 [ADR 0002](../docs/adr/0002-技术栈选型与双版本架构.md)、[ADR 0004](../docs/adr/0004-M0工程骨架与首批依赖.md)。
