# src/main/ai

**职责**：核心域。PointStudio 是 AI 工作台，与 AI 本质相关的一切都在这里，收在一个包。

按 Cherry Studio 的 `ai/` 分类法：模型接入、工具协议、智能体、领域模型同属核心域，不该各自成包——它们的变更节奏一致、被同一批调用方使用，拆开只会多出一堆跨包跳转。

## 内容

| 文件 | 职责 | 一句话 |
|---|---|---|
| `domain.md` | 领域模型与用例 | 会话、任务、产物的核心类型与纯逻辑运算 |
| `providers.md` | 模型接入 | 把各家 AI SDK 的 provider 差异收口 |
| `tools.md` | 工具协议 | 统一 `Tool` 接口与可用工具注册表 |
| `agent.md` | 规划与执行 | `Plan` 协议与执行循环 |

这四部分**不必拆成包**，但**必须互不越界**：`domain` 不碰 SDK，`providers` 不含业务规则，`tools` 不做权限判断，`agent` 不写死任何模型厂商。

## 依赖

- **允许**：`core`（运行时抽象）、`data`（经仓储接口）
- **禁止**：
  - `react`、任何渲染进程代码；
  - 感知版本差异 —— 个人版 / 企业版的策略由 `policy` 注入，本包不出现 `if (isEnterprise)`；
  - 把 LLM 调用写死在某家 SDK 上 —— 一律走 `providers.md` 定义的接口。

## 判据

**把 `electron` 换掉，本包应当原样可用。** 这是它和 `core` 的分界线：`core` 是跑应用的地基（允许依赖 Electron），`ai` 是业务内核（不允许）。

## 现状

已落地 `domain/chat.ts`、`domain/assistant.ts`、`domain/conversation.ts`（会话与消息模型、标题派生与校验）（`splitIntoChunks`，把文本按码点切成流式块，契约测试在 `tests/js/chat.test.ts`）。`tools/` 已落地协议、注册表与三个只读内置工具（now / calc / read_text_file）；`agent/` 已落地 Plan 协议（校验、状态推进、进度汇总）与执行循环（确认门、失败即停、步骤回调）；「模型生成计划」与「失败后重规划」仍未做。
