# packages/providers

**职责**：模型接入层。把 Vercel AI SDK 6 的 provider 差异收在这里，向上只暴露统一的 `ModelProvider` 接口（能力声明、流式调用、token 计量、错误归一化）。

**允许依赖**：`ai` 与 `@ai-sdk/*` 系列。

**禁止**：

- 禁止 import `electron` / `react`；
- 禁止在业务代码里直接 new 某个厂商 SDK——一律经本包；
- 禁止把 API Key 读取逻辑写在这里（密钥由外壳注入）。

**企业版差异**：企业版切自建网关时，只替换本包的 provider 实现，调用方无感。

**现状**：空壳。选型见 [ADR 0002](../../docs/adr/0002-技术栈选型与双版本架构.md)。
