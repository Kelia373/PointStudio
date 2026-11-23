# PointStudio

AI 工作台项目。区分**个人版**与**企业版**，共享同一套任务规划内核。


## 文档

| 文件 | 内容 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | 仓库规则入口（人与 AI 都读） |
| [docs/00-项目定位与边界.md](docs/00-项目定位与边界.md) | 产品定位、两版差异、不做什么 |
| [docs/01-开发工作规则.md](docs/01-开发工作规则.md) | 改动生命周期、测试契约、提交规范、自检清单 |
| [docs/02-任务规划能力.md](docs/02-任务规划能力.md) | 协作协议 + 产品规划内核定义 |
| [docs/03-能力与工具链盘点.md](docs/03-能力与工具链盘点.md) | 执行 agent 能力清单与环境坑 |
| [docs/adr/](docs/adr/) | 架构决策记录 |
| [resources/](resources/README.md) | 参考资料：论文、手册、截图、摘录（非项目内容） |

## 仓库结构（约定）

```
src/                       源码根
  main/                    主进程：入口 + 内核目录
    index.ts               组合根：装配、建窗、注册 IPC
    core/                  应用运行时：生命周期/DI、路径、日志、窗口、调度
    ipc/                   跨进程边界
    data/                  数据层：仓储接口 + SQLite 适配
    ai/                    核心域：领域模型、模型接入、工具协议、智能体
    features/              大型业务领域（空，刻意）
    services/              中小业务服务（空）
    utils/                 无状态辅助（零依赖）
    i18n/                  本地化
    policy/                云端策略（预留，当前无调用方）
    remote/                远端协议（预留，状态待决）
    ui/                    跨端组件
  preload/                 预加载：renderer 与 main 之间的白名单桥
  renderer/                渲染进程（React）
docs/                      规范与决策
scripts/                   构建与检查脚本
dev.cmd                    双击启动开发模式的入口
resources/                 参考资料（非项目内容）
out/                       构建产物（已 gitignore）
```

技术栈与双版本架构见 [ADR 0002](docs/adr/0002-技术栈选型与双版本架构.md)。

## 参考基线

`D:\Project\NewGame\ai-workstation\ref\cherry-studio` —— Cherry Studio 2.2.3（AGPL-3.0），**只读**：不修改、不提交、不复制代码进 `src/`。当前为 partial clone（仅 tree，无工作树）。

其架构约定见同目录 [cherry-CLAUDE.md](D:/Project/NewGame/ai-workstation/ref/cherry-CLAUDE.md)。

## 开始

```bash
git clone https://github.com/Kelia373/PointStudio.git
cd PointStudio
```

## 启动与构建

| 做什么 | 怎么用 |
| --- | --- |
| **启动开发**（热更新） | 双击根目录 `dev.cmd`，或 `powershell -File scripts\dev.ps1` |
| 一次性构建 | `powershell -File scripts\build.ps1` → 产物在 `out` |
| 跑检查（类型 + 门禁） | `powershell -File scripts\check.ps1` |
| 跑 JS 测试 | `node tests/js/all.test.ts` |
| 清理构建产物 | `powershell -File scripts\clean.ps1` |

启动后**终端别关**：改 React 界面会热更新（保存即变）；改主进程（`src/main`、`src/preload`）**需要手动重启 dev**。

> ⚠️ 本机依赖不在仓库内：`node_modules` 是指向 `D:\deveTools\ps-node` 的目录链接，因为 DSH 工作区目录会阻止 exe 执行。改完 `package.json` 的依赖要先同步过去再安装，详见 [AGENTS.md](AGENTS.md) 的「本机环境事实」。

## 分支与合并

主干是 **`master`**，受分支保护：**不能直接推送**，改动必须走分支 + PR，且 CI「TDD 门禁」绿灯后才能 Squash 合并。

```bash
git switch master && git pull
git switch -c feature/xxx        # 或 fix/、docs/、chore/
# ...开发、提交...
git push -u origin feature/xxx   # 然后在 GitHub 开 PR
```

完整规则见 [docs/01 第 3 节](docs/01-开发工作规则.md)。
