# ai/agent

**职责**：任务的规划与执行循环。实现 `docs/02-任务规划能力.md` 定义的 `Plan` 协议：分级 → 澄清 → 勘查 → 计划 → 执行 → 校验 → 交付。

**核心对象**：`Plan`（goal / assumptions / steps / stopConditions / rollback / costEstimate），每个 step 必须带可判断的 `expect`。

**允许依赖**：包内 `domain.md`、`tools.md`、`providers.md`；包外 `core`（运行时抽象）、`data`（仓储接口）。

**禁止**：

- 禁止 import `electron` / `react`；
- 禁止感知版本差异（个人版 / 企业版的策略校验由 `policy` 注入）；
- 禁止把 LLM 调用写死在某家 SDK 上（走 `providers` 接口）。
