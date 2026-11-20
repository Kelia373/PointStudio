# packages/storage

**职责**：存储接口与适配实现。向上暴露仓储（repository）接口，向下屏蔽 SQLite / PostgreSQL 的差异。

**技术选择**：Drizzle ORM 统一建模；个人版 `better-sqlite3`（同步驱动），企业版 PostgreSQL。

**铁律**：

- 业务代码**不得**直接 `getDb()` 或写 SQL，一律经仓储接口；
- schema 变更必须走追加迁移，**永不改写已发布的迁移**；
- 写多步操作必须在一个事务里完成。

**禁止**：import `electron` / `react`；把方言判断散在业务层（方言差异只允许存在于本包的适配器内）。

**现状**：空壳。依据 [ADR 0002](../../docs/adr/0002-技术栈选型与双版本架构.md)。
