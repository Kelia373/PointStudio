# PointStudio 文档索引

<!-- 由 scripts/gen-doc-index.mjs 生成，请勿手改；改完文档跑 `pnpm docs:index`。 -->

规则性内容以根目录 `AGENTS.md` 为准，本页只是入口索引。

## 总纲

| 文档 | 说明 |
| --- | --- |
| [项目定位与边界](./00-项目定位与边界.md) | PointStudio 是一套面向小说与游戏内容创作者的 **本地优先（Local-First）双屏多智能体工作台**。它吸收了 Cherry Studio 的丰富配置与权限档位、Orca 的驻场数字员工（`SOUL` + `MEMORY` + 交接闭环）、T3 的极速响应与旁路… |
| [01 · 开发工作规则](./01-开发工作规则.md) | 适用范围：本仓库所有人工与 AI 协作的改动。规则冲突时优先级：`AGENTS.md` > 本文件 > 局部约定。 |
| [02 · 任务规划能力](./02-任务规划能力.md) | 「任务规划」有两层含义，此处都覆盖： |
| [03 · 能力与工具链盘点（当前执行 agent）](./03-能力与工具链盘点.md) | 记录本机这套 agent 实际能干什么、边界在哪，供后续任务规划时判断「这件事能不能做、要几步」。 |
| [04 · 能力地图（模块归属 · 里程碑 · 状态）](./04-能力地图.md) | 本文回答一个问题：**「AI 工作台」这个品类的基本能力有哪些、每一项落在哪个模块、做到什么算完成。** |

## ADR

| 文档 | 说明 |
| --- | --- |
| [ADR 0001 · 技术栈与参考基线](./adr/0001-技术栈与参考基线.md) | 仓库刚初始化，尚无代码。需要先定：运行形态、技术栈、包管理、参考基线。 |
| [ADR 0002 · 技术栈选型与双版本架构](./adr/0002-技术栈选型与双版本架构.md) | PointStudio 是 AI 工作台，**个人版开源、企业版闭源**，两版必须能并行演进。参考基线为 Cherry Studio 2.2.3（Electron + React + TS，AGPL-3.0），另有十个同类项目横评。 |
| [ADR 0004 · M0 工程骨架与首批依赖](./adr/0004-M0工程骨架与首批依赖.md) | M0 的目标是打通"窗口能开、文字能动"的最短链路，用来前置 Electron 工具链风险，同时让仓库从"只有文档"变成"能跑的东西"。在此之前仓库没有根 `package.json`，`apps/desktop` 只有一份 README。 |
| [ADR 0005 · 模型接入改为自研实现口，DeepSeek 首发](./adr/0005-模型接入改为自研实现口.md) | `ADR 0002` 第 8 条当时的判断是「自写多 provider 适配是纯负债，AI SDK 已覆盖」。Alpha 现在改为反方向：**我们自己提供实现口（port），先实现 DeepSeek，后续再补其他平台**。 |
| [ADR 0006：以 Agent 为中心的装配模型（身份 / 项目 / 派遣）](./adr/0006-Agent为中心的装配模型.md) | 现在的模型是「会话绑一个助手」：`conversations.assistantId`。它把三件事糊在了一起——谁在做、在哪个项目做、这次执行了什么。助手改了提示词或换了工具之后，历史会话就对不上「当时到底是谁、带着什么能力在干」。 |
| [ADR 0007：壳、统一注册表、故障自愈插件宿主与四大独家交互底座](./adr/0007-壳-路由与插件框架.md) | PointStudio 需要同时满足四件事： |

## 设计笔记

| 文档 | 说明 |
| --- | --- |
| [Agent 与工作区分离 · 实现方案（技术版）](./notes/proposed/architecture/2026-11-23-agent-workspace-separation.md) | 这是设计文档，不是教程。所有结论都以 Cherry Studio 的**实际实现**为约束，不凭空设计。 |
| [全局设置 6 级架构与「API + CLI 双轨模型接入」施工单（L2）](./notes/proposed/architecture/2026-11-28-settings-and-model-access.md) | 将原本仅有 3 个扁平占位项的设置页（`SettingsPage.tsx` + `SettingsPanel.tsx`）升级为 **6 大一级分组 × 二级子模块的完整工作台设置中心**，并重点打通 **第一级 `AI Agent` 的模型接入体系**： |

## 参考

| 文档 | 说明 |
| --- | --- |
| [PointStudio 插件开发指南（架构规格）](./references/plugin-development.md) | PointStudio 的插件体系参考 DSH 的双端整合思路，遵循两条基本原则： |
| [渲染层重构、60fps 性能优化与插件底座施工单](./references/ui-remediation.md) | **目标**：为「Orca 式双轴会话（Agent ⇄ Project）」与「PandaOrchestrator 协同路由 + 升档梯队」留好纯 JSON 契约槽，遵守“只加可选字段、缺省分支有测试”的演进规则。 |
| [主进程目录结构与依赖规则（`src/main`）](./references/architecture/main-architecture.md) | 本文是 `src/main/` 目录分类与依赖方向的权威参考：每个目录是什么、靠什么规则阻止它蔓延、新能力往哪放。 |
| [渲染进程结构（`src/renderer`）](./references/architecture/renderer.md) | 渲染层的目录约定、组件组织方式，以及「界面不碰数据」这条硬规则。 |
| [共享层（`src/shared`）](./references/architecture/shared-layer.md) | 跨进程共享代码放在哪、什么时候才值得建，以及「只放类型和纯函数」的约束。 |
| [工具进程（utility process）](./references/architecture/utility-process.md) | 什么情况下该把活丢进独立进程、怎么做最小实现，以及和 worker_threads 的区别。 |
