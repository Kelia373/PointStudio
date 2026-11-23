# src/main/data

**职责**：数据层。向上暴露仓储（repository）接口，向下屏蔽 SQLite / PostgreSQL 的差异。

**技术选择**：Drizzle ORM 统一建模；个人版 `better-sqlite3`（同步驱动），企业版 PostgreSQL。

## 铁律

- 业务代码**不得**直接 `getDb()` 或写 SQL，一律经仓储接口；
- schema 变更必须走追加迁移，**永不改写已发布的迁移**；
- 多步写操作必须在一个事务里完成。

## 禁止

- `electron` / `react`；
- 把方言判断散在业务层 —— 方言差异只允许存在于本包的适配器内。

## 依赖

允许依赖 `core`（运行时抽象）；向 `ai` / `policy` 等上层暴露仓储接口。

## 现状

当前适配器是 `fileStore.ts` 的 `JsonFileStore`（会话与消息分两个文件存：messages 增长快，混在一起每次写都要重写全部消息）（单 JSON 文件 + 临时文件 rename 原子写），零依赖、可单测。这是**过渡适配器**：ADR 0002 定的 SQLite + Drizzle 需要重编 `better-sqlite3`（native），单独一步做；换适配器时上层（services / ipc / 界面）不动，因为它们只认构造函数注入的存储对象。

已知边界：单进程、单用户、无并发写保护；JSON 解析失败时读作空集合并保留原文件，不做自动修复。依据 [ADR 0002](../../docs/adr/0002-技术栈选型与双版本架构.md)。
