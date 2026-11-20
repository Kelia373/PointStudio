# PointStudio

AI 工作台项目。区分**个人版**与**企业版**，共享同一套任务规划内核。

> 当前阶段：规范建设，尚无业务代码。

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
apps/              面向用户的壳，只做装配
  desktop/         个人版（Electron）
  server/          企业版（占位，未实现）
packages/          与外壳无关的能力，禁止依赖 UI
  core/            领域模型与用例（纯逻辑，零 IO）
  agent/           规划与执行循环
  providers/       模型接入
  tools/           工具协议与注册表
  policy/          策略层：两版差异的唯一落点
  storage/         存储接口与适配（SQLite / Postgres）
  remote/          远端协议与传输（企业版用，接口先定）
  ui/              共享 UI 组件（仅桌面端依赖）
docs/              规范与决策
resources/         参考资料（非项目内容，受体积规则约束）
ref/               外部参考代码，只读，永不提交（已 gitignore）
```

技术栈与双版本架构见 [ADR 0002](docs/adr/0002-技术栈选型与双版本架构.md)。

## 参考基线

`D:\Project\NewGame\ai-workstation\ref\cherry-studio` —— Cherry Studio 2.2.3（AGPL-3.0），**只读**：不修改、不提交、不复制代码进 `apps/` `packages/`。当前为 partial clone（仅 tree，无工作树）。

其架构约定见同目录 [cherry-CLAUDE.md](D:/Project/NewGame/ai-workstation/ref/cherry-CLAUDE.md)。

## 开始

```bash
git clone https://github.com/Kelia373/PointStudio.git
cd PointStudio
```
