# src/main/services

**职责**：中小型业务服务，一件事一个文件。

## 与 `features/` 的分界

同一个业务，**体量**决定放哪：

| 体量 | 放哪 |
|---|---|
| 一个文件装得下 | `services/<name>.ts` |
| 需要几个私有辅助文件 | `services/<name>/`（原地长子目录，不跳级） |
| 长成多文件的大领域、有自己的页面 | `features/<name>/` |

## 内容举例（将来可能出现的）

- 文件处理流水线
- 搜索与索引
- 知识库检索
- 导入 / 导出
- 备份

现在都还没有，此目录保持空。

## 铁律

1. **对外入口唯一**：`services/<name>/` 子目录只暴露一个 `index.ts`，其余文件私有。
2. **服务之间可以互相调用，但不能成环**。
3. **不做版本判断**：个人版 / 企业版差异归 `policy`。
4. **不直接碰 Electron**：需要平台能力时走 `core` 的接口注入。

## 依赖

允许依赖 `core`、`data`、`ai`；被 `src/main` / `ipc` 调用。

## 现状

已有：`chatReply.ts`（假流式回复）、`chatEngine.ts`（有 Key 走真模型、无 Key 降级）、`chatFlow.ts`（一次问答的落库编排：先存用户消息 → 流式产出 → 存助手消息，失败时保留已产出部分并标记 error）、`assistantService.ts`（助手增删改查）、`conversationService.ts`（会话与消息：建/改名/删（级联删消息）、追加/编辑/删除消息、按最近活动排序）、`providerSettingsService.ts`（模型凭据读写，对外只给脱敏视图）、`planService.ts`（调模型生成计划：拼提示词 → 解析 → 协议校验 → 带错误码重试，默认最多 2 次；`replanAfterFailure` 把失败现场交给模型产出修订版，旧计划保持不可变）。

上下文：`chatFlow` 在落库前先读历史，用 `ai/domain/context.ts` 的 `trimHistory` 按条数 + 估算 token 裁剪，被丢掉的条数通过 `onContextTrimmed` 回调上报（界面显示提示），不静默丢弃。

约定：服务层只依赖注入进来的存储对象与时钟，不 import electron，因此可脱离运行环境单测。
