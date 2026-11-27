# Agent 与工作区分离 · 实现方案（技术版）

> 状态：草案，未实现
> 日期：2026-11-23
> 目标读者：实现者（我们自己）
> 前置知识：SQLite 基础、SQL DDL、Electron 主/渲染进程模型、Git 对象模型

---

## 0. 文档定位

这是设计文档，不是教程。所有结论都以 Cherry Studio 的**实际实现**为约束，不凭空设计。

术语约定：

| 缩写 | 含义 |
| --- | --- |
| WS | Workspace，工作区，一条可被租用的资源记录 |
| AG | Agent，母体，能力的只读基线 |
| IN | Instance，分身，一次执行的全部可变状态 |
| LEASE | 租约，WS 侧的独占占用凭据 |

---

## 1. 目标与非目标

### 1.1 目标

1. **WS 实体化**：目录从 task 上的字符串提升为一等实体，可被多处引用、可改名、可绑 worktree。
2. **WS 侧独占**：一个 WS 同一时刻只允许一个 IN 持有，靠数据库唯一约束强制，不靠应用逻辑。
3. **记忆分层**：记忆按 `global / workspace` 两档隔离，换 WS 不可见。
4. **分身**：同一 AG 可在多个 WS 并行，状态分叉、互不干扰；AG 能力不复制（引用 + 冻结基线）。
5. **可撤销**：Agent 的文件改动按任务可 diff、可回滚。
6. **收尾闭环**：任务结束时产出决策记录、记忆候选、技能文件。

### 1.2 非目标

- 不改渲染层框架、模型接入、Provider 体系。
- 不重写技能机制（复用其目录即注册的托管 registry）。
- 不做多 Agent 同仓协作、跨机迁移、Agent 市场。
- 不引入服务端数据库（单机 SQLite 足够，企业版另议）。

---

## 2. 现有架构基线（Cherry Studio）

### 2.1 进程与目录

```
src/main/        Node 进程
  core/          IoC 容器、paths、logger、window、scheduler/jobs
  data/          Db、Cache、Preference、DataApi、BootConfig
  ai/            providers、middleware、MCP、agents、streams
  services/      小粒度业务服务（agents 在 src/main/services/agents/）
  ipc/           IpcApi —— 到渲染进程的类型化边界
src/renderer/    Chromium 进程（React 19）
src/preload/     contextBridge
src/shared/      跨进程类型与契约
packages/        ui / aiCore / ai-sdk-provider / provider-registry
```

### 2.2 四套数据系统

| 系统 | 介质 | 生命周期 | 用途 |
| --- | --- | --- | --- |
| BootConfig | JSON 文件 | 生命周期前（同步） | Chromium flags、硬件加速 |
| Cache | 内存 / localStorage / main 侧 JSON | 运行期 | 临时数据、跨窗口协调 |
| Preference | SQLite | 生命周期后 | 用户设置 |
| DataApi | SQLite（Drizzle + LibSQL） | 生命周期后 | **业务数据：topics、messages、agents、tasks** |

**关键：v2.0.0 起业务数据已从 Dexie(IndexedDB)+Redux Persist 一次性迁到 SQLite（Drizzle ORM + LibSQL），渲染进程不再持有真相。**

### 2.3 调用链

```
React UI → useQuery/useMutation → IPC → IpcApi handler
                                        → Service 层
                                        → Repository 层
                                        → SQLite (Drizzle)
```

### 2.4 现有实体（与本方案相关的部分）

- **agents**：角色、model、prompt、skills、knowledge、permission mode。**permission 挂在 AG 上**（已符合要求）。
- **runtime**：Agent 可绑定不同引擎（Pi / DeepSeek Harness / 增强 Claude Agent），**各引擎支持的权限模式不同**（Pi 无「仅规划」，DeepSeek Harness 无「智能批准」）。
- **tasks**：一次连续工作记录，**携带 working directory 字符串**。
- **skills**：托管目录 `$CHERRY_STUDIO_SKILLS_DIR`，写入 `SKILL.md` 后自动同步注册。
- **memory**：以 memory-as-tool 形式存在，**作用域挂在 AG 上，跨 task 共享**。

### 2.5 现状与本方案的差距

| 现状 | 差距 |
| --- | --- |
| workingDir 是 task 上的字符串 | 无实体、无引用、无法加约束 |
| 无独占机制 | 两个 task 可绑同一目录并并发写 |
| memory 作用域仅到 AG | 跨项目串味 |
| task 一个 = 一次运行 | 无「同一 AG 的多个并行状态」概念 |
| 工具直连 FS | 无变更记录、无回滚 |
| task 结束无自动沉淀 | 经验不累积 |

**结论：目录逻辑上已归 task（非 AG），所以不是「从 AG 身上摘」，而是「从字符串升成实体」。**

---

## 3. 目标数据模型

### 3.0 关系

```
agents (1) ──< agent_versions (不可变快照)
   │
   └──(1)──< agent_instances (N)
                │  id ──────────────┐
                │  base_agent_version│
                ├──> workspaces (N)  │
                │        │           │
                │        └──< leases >┘  (PK = workspace_id)
                │
                └──< memories (scope=workspace, workspace_id)
tasks ──> agent_instances.id   (替代原 working_dir)
```

### 3.1 workspaces

```sql
CREATE TABLE workspaces (
  id            TEXT PRIMARY KEY,              -- nanoid
  root_path     TEXT NOT NULL,                 -- 绝对路径，规范化
  git_root      TEXT,                          -- 可空：非 git 目录
  worktree_id   TEXT,                          -- git worktree 标识（可空）
  head_commit   TEXT,                          -- 建记录时的 HEAD，可空
  label         TEXT,                          -- 展示名
  created_at    INTEGER NOT NULL,              -- epoch ms
  last_seen_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_workspaces_root ON workspaces(root_path, IFNULL(worktree_id, ''));
```

设计要点：

- **唯一约束带 worktree_id**：同一路径在不同 worktree 下是不同 WS（分支切换后内容不同，不能混为一谈）。
- `root_path` 必须规范化（resolve、去尾斜杠、Windows 下统一分隔符）后再比较。
- 不存在「路径改了自动跟随」的魔法；改名走显式更新，引用它的 task 因为存的是 `id` 而自动正确。

### 3.2 agent_versions（冻结基线的载体）

```sql
CREATE TABLE agent_versions (
  agent_id    TEXT NOT NULL,
  version     INTEGER NOT NULL,
  snapshot    TEXT NOT NULL,        -- JSON：prompt/model/skills/knowledge/permission 的完整快照
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (agent_id, version)
);
ALTER TABLE agents ADD COLUMN current_version INTEGER NOT NULL DEFAULT 1;
```

**为什么需要独立快照表**：冻结基线要求「分身创建那一刻的 AG 配置永远可还原」。如果只存一个 version 数字，AG 后续被改，旧版本就不存在了。**快照必须不可变（只增不改）。**

### 3.3 agent_instances

```sql
CREATE TABLE agent_instances (
  id                 TEXT PRIMARY KEY,
  agent_id           TEXT NOT NULL,
  base_agent_version INTEGER NOT NULL,   -- 冻结基线
  workspace_id       TEXT,              -- NULL = 未绑定（游离态）
  session_id         TEXT,              -- 与 runtime 会话关联
  runtime            TEXT NOT NULL,     -- 'pi' | 'deepseek-harness' | 'claude-agent'
  state              TEXT NOT NULL,     -- 'active' | 'detached' | 'archived'
  created_at         INTEGER NOT NULL,
  detached_at        INTEGER
);
CREATE INDEX ix_instances_agent ON agent_instances(agent_id, state);
```

**核心约束：分身只记录状态，不复制能力。** 加载时按 `(agent_id, base_agent_version)` 从 `agent_versions` 取快照，而不是读 `agents` 当前值。

### 3.4 leases

```sql
CREATE TABLE leases (
  workspace_id  TEXT PRIMARY KEY,       -- 独占的全部秘密在这里
  instance_id   TEXT NOT NULL,
  acquired_at   INTEGER NOT NULL,
  heartbeat_at  INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL        -- 超时自动可回收
);
```

### 3.5 memories 改造

```sql
ALTER TABLE memories ADD COLUMN scope        TEXT NOT NULL DEFAULT 'workspace'; -- 'global' | 'workspace'
ALTER TABLE memories ADD COLUMN workspace_id TEXT;        -- scope=workspace 时必填
ALTER TABLE memories ADD COLUMN provenance   TEXT;        -- JSON: {instanceId, agentId, agentVersion, sourceTaskId}
ALTER TABLE memories ADD COLUMN promote_state TEXT NOT NULL DEFAULT 'none'; -- none|pending|promoted|conflict
CREATE INDEX ix_memories_scope ON memories(scope, workspace_id);
CREATE INDEX ix_memories_agent ON memories(agent_id, scope);
```

**迁移默认值必须是 `workspace`**：历史记忆语义未知，按最保守处理。误留 = 重复学习；误带 = 泄密。

### 3.6 tasks 改造

```sql
ALTER TABLE tasks ADD COLUMN instance_id TEXT;
ALTER TABLE tasks ADD COLUMN workspace_id TEXT;   -- 冗余存一份，便于查询；真相由 instance 决定
-- working_dir 字段保留但不再作为真相来源（迁移期双写，下线前删除）
```

---

## 4. 关键机制设计

### 4.1 WorkspaceResolver：唯一路径出口

**规则：任何工具（文件读写、终端、MCP 资源）拿路径，都必须经它。禁止工具持有或接收绝对路径。**

```ts
interface WorkspaceResolver {
  // 解析实例当前工作根；无绑定则抛错
  resolveRoot(instanceId: string): Promise<string>;

  // 带事务的写操作：所有写文件/执行命令的工具包装在此
  withJournal<T>(
    instanceId: string,
    fn: (ctx: { root: string; journal: Journal }) => Promise<T>
  ): Promise<T>;
}

interface Journal {
  record(path: string, beforeHash: string | null, afterHash: string | null): void;
  entries(): JournalEntry[];
}
```

实现位置建议：`src/main/services/workspace/`，由 IoC 容器注入到工具层。

**为什么必须集中**：如果每个工具自己拼路径，租约、事务、审计三件事就没有统一拦截点。这是整套方案的承重墙。

### 4.2 租约：靠唯一约束 + 事务 + 心跳

**获取（含回收过期）**

```ts
// 必须在 BEGIN IMMEDIATE 事务内执行，避免 check-then-act 竞态
db.transaction('immediate', () => {
  const now = Date.now();
  const existing = selectLease(workspaceId);
  if (existing && existing.expires_at > now) {
    throw new WorkspaceBusyError(existing.instance_id);
  }
  // 过期则回收（覆盖写）
  upsertLease({ workspaceId, instanceId, acquiredAt: now,
                heartbeatAt: now, expiresAt: now + TTL });
});
```

- `BEGIN IMMEDIATE` 立刻取写锁，避免两个连接同时读到「没有租约」。
- 即使不加事务，`PRIMARY KEY` 也保证第二个 INSERT 失败，但**回收逻辑**需要事务才安全。
- **不要用进程内内存锁**：多窗口、多实例、崩溃重启都会破。

**心跳与回收**

- 持有方每 `TTL/3` 更新 `heartbeat_at` 与 `expires_at`。
- 回收只发生在「获取时发现过期」，**不做后台扫描**（避免两个回收者互相打架）。
- TTL 待定（见 §10）。

**释放**

- 正常结束、异常退出、任务取消都要释放；崩溃靠 TTL 兜底。
- 释放建议做成 `finally` 语义 + 进程退出钩子双保险。

### 4.3 记忆分层与晋升

**检索（唯一入口）**

```sql
SELECT * FROM memories
WHERE agent_id = :agentId
  AND (
        scope = 'global'
     OR (scope = 'workspace' AND workspace_id = :currentWorkspaceId)
      )
ORDER BY updated_at DESC
LIMIT :k;
```

**写入默认**：`scope='workspace'`、`workspace_id=当前`、`promote_state='none'`。

**晋升状态机**

```
none ──(收尾抽取)──> pending ──(人工批准)──> promoted
                        └──────(人工拒绝)──> none (或直接丢弃)
                        └──(检测到互斥)────> conflict
```

- **`promoted` 的条目才允许出现在 `scope='global'` 的检索结果里。**
- `conflict` 判定：同 scope、同 agent、语义互斥（例如「用 pnpm」vs「用 npm」）。第一版用人工标记 + 简单关键词冲突表，不做自动语义判断。
- 晋升后写 `provenance`，前端可显示「此经验来自 A 项目」。

**关键：不改 AG 的检索链**。Cherry 的 memory 是 memory-as-tool，拦截点在工具实现内部，注入上面的 WHERE 条件即可。

### 4.4 分身与冻结基线

**创建**

```
1. 在 agent_versions 中有 (agent_id, current_version) 快照 → 取该 version
2. INSERT agent_instances(agent_id, base_agent_version=version, runtime, state='active')
3. 绑定 WS：INSERT lease 成功后再 UPDATE instances.workspace_id
4. 复制 scoped memory 指针？不 —— 分身在 WS 内产生的记忆自动带 workspace_id，无需复制
```

**启动时加载**

```
加载 (prompt, model, skills, knowledge, permission) ← agent_versions(base_agent_version)
不是 ← agents.current_version
```

**这是与「复制 Agent」的根本区别**：能力永远一份，副本只是引用。

**落在哪一层**：分身必须建在 **runtime 之上**。即 runtime 只负责「按给定的配置跑一次会话」，分身负责「跑哪份配置、在哪个 WS、状态如何」。否则每加一个 runtime（Pi/DeepSeek/Claude）都要重做分身逻辑。

**解绑 = 交接**

```
1. 生成 handoff 记录：进行到哪、剩余什么、注意事项、已有产物
2. 释放 lease
3. instances.state = 'detached'，detached_at = now
```

**不做跨机迁移**：session_id 与 runtime 绑定本机进程，迁移无意义。

### 4.5 事务化：借 Git 对象模型

**原理**：`git stash create` 会生成一个 commit 对象**表示当前工作树状态**，但**不修改工作树、不修改索引、不产生 stash 记录**。这是最干净的快照手段。

**任务开始**

```bash
# 有未提交改动也能拿到完整状态
SNAP=$(git stash create)          # 返回 commit sha
[ -z "$SNAP" ] && SNAP=$(git rev-parse HEAD)   # 干净工作树则用 HEAD
```

**变更记录**：每次工具写文件，由 `Journal` 记 `(path, beforeHash, afterHash)`。同时在任务结束时对照快照做一次兜底扫描（防止工具绕过 resolver）。

**任务结束**

```bash
git diff --stat "$SNAP"           # 汇总
git diff "$SNAP" -- <paths>       # 逐文件
```

**回滚**

```bash
git checkout "$SNAP" -- .                  # 恢复已跟踪文件
git clean -fd -- <本任务新建的未跟踪文件>   # 删除新建文件（列表来自 Journal）
```

注意：`git checkout <sha> -- .` 只恢复快照中存在的文件；快照后**新建**的文件不会自动消失，必须用 `git clean` 或按 Journal 显式删除。这是最容易漏的一步。

**非 Git 目录退化**

- 快照 = 将目录复制到 `~/.cache/<app>/snapshots/<taskId>/`（硬链接优先，节省空间）
- 回滚 = 反向同步 + 删除新增文件
- 明确告知用户「此目录非 Git，回滚基于文件副本，不保留历史」

**不建议**：自己实现内容寻址存储。Git 对象库已经做完了这件事，且能被 `git` 命令直接检查。

### 4.6 收尾闭环（closeout job）

**触发**：task 状态迁移到「完成/取消」的事件（不是轮询）。

**产出**

| 产出 | 落点 | 说明 |
| --- | --- | --- |
| 决策记录 | `docs/notes/implemented/<class>/<date>-<topic>.md` | 人可读，含证据（测试输出、diff 摘要） |
| 记忆候选 | memories 表，`scope='workspace'`、`promote_state='pending'` | 由 LLM 抽取，必须带 provenance |
| 技能 | `$CHERRY_STUDIO_SKILLS_DIR/<name>/SKILL.md` | **写入即自动注册，零集成** |

**实现要点**

- 复用主进程 `scheduler/jobs`，用**低优先级队列**，避免与前台写竞争 SQLite 写锁。
- 幂等：以 `taskId` 为键，重复触发只更新不重复插入。
- 抽取失败不阻塞任务结束（best-effort），失败记日志并在 UI 提示「本次未沉淀」。

---

## 5. 改动落点清单

| 文件/目录 | 改动 |
| --- | --- |
| `src/main/data/`（Db/schema） | 新增 4 张表、3 处 ALTER、索引 |
| `src/main/data/migration/` | 新增一次性迁移（沿用其线性升级约定） |
| `src/main/services/agents/` | agents 版本化；instance 创建/解绑 |
| `src/main/services/workspace/`（新） | WorkspaceResolver + LeaseService + Journal |
| `src/main/services/memory/` | 检索加 scope 过滤；写入加默认值 |
| `src/main/scheduler/jobs/` | closeout job |
| 工具层（文件/终端/MCP） | 全部改走 `resolveRoot(instanceId)` / `withJournal` |
| `src/shared/` | instance / workspace / lease 的类型与 IPC 契约 |
| `src/renderer/`（最小） | Agent 卡片下挂分身列表；task 上显示 WS 与租约状态 |

**渲染层尽量不动**：v2 已把真相收到主进程，不要往回加渲染层状态。

---

## 6. 迁移方案

沿用 Cherry v2 迁移的做法：**一次性、线性、幂等、可校验。**

```
步骤（单事务，失败整体回滚）
1. 建表（workspaces / agent_versions / agent_instances / leases）与索引
2. agents 写入 current_version=1，并为每个 agent 生成 version=1 的快照
3. 扫描 tasks.working_dir 的去重集合 → 每个生成一条 workspaces 记录 → 回填 tasks.workspace_id
4. 为「运行中」的 task 生成 agent_instances（base_agent_version=1），回填 tasks.instance_id
5. memories 全部置 scope='workspace' + workspace_id=该 task 的 WS（无法归属的置 NULL 且 scope='workspace'）
6. 校验：行数比对、外键完整性、无 NULL 的必填字段
```

**校验失败处理**：整个迁移回滚，应用提示用户备份后重试；不做「部分成功」状态。

---

## 7. 验收判据

| # | 判据 | 验证手段 |
| --- | --- | --- |
| AC1 | 同一 WS 的第二个 instance 绑定被拒 | 并发起两个任务绑同一目录，断言第二个抛 `WorkspaceBusyError` |
| AC2 | 崩溃后租约按 TTL 自动可回收 | 强杀进程，等待 TTL，断言新 instance 能获取 |
| AC3 | 分身间 workspace 级记忆互不可见 | 两个分身各写一条，交叉检索返回空 |
| AC4 | 换 WS 后检索不到原 WS 记忆 | 同一 AG 两个 WS，断言 A 的记忆在 B 下不可见 |
| AC5 | 晋升后全局可见且带 provenance | 人工批准一条，断言新分身可检索到且来源字段正确 |
| AC6 | 互斥条目不自动合并 | 造两条冲突记忆，断言状态为 `conflict` 且不被合并 |
| AC7 | 分身不改写母体配置 | 修改 agents.current_version 后，已有分身仍按 base_agent_version 加载 |
| AC8 | 任务可回滚到开始前 | 任务改 3 个文件、新建 1 个，回滚后 diff 为空且新文件消失 |
| AC9 | 收尾产出三类文件 | 跑一个任务，断言 note/memory/skill 三者落点正确 |
| AC10 | 技能写入即被识别 | 收尾写 `SKILL.md` 后，技能列表无需重启即可见 |

**AC1、AC3、AC8 为生死线。** 任一不过，方案不成立。

---

## 8. 风险与坑

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| SQLite 单写者 | closeout 与交互写竞争会 `SQLITE_BUSY` | 开 WAL、设 `busy_timeout`、closeout 低优先级队列 |
| 双开应用实例 | 两个进程共写同一 DB 文件 | 依赖 SQLite 文件锁 + 应用层单实例锁；租约本身也靠主键保护 |
| `git checkout -- .` 残留 | 快照后新建的文件不会消失 | 必须按 Journal 清理未跟踪文件 |
| worktree 同路径 | 不同分支同路径不能共用 WS | 唯一索引带 worktree_id |
| runtime 差异 | 三种引擎能力不同（权限模式、会话恢复） | 分身放在 runtime 之上，只依赖「给定配置跑一次会话」这一最小契约 |
| 记忆抽取质量 | LLM 抽取会造垃圾条目 | 全部落 `pending`，项目内自动接受但可回滚；只有晋升需人审 |
| 大对象入库 | 截图、附件塞进 SQLite 会膨胀 | 二进制存 FS，库内只存路径；限制单行大小 |
| 迁移不可逆 | 版本化后回旧版本 | 迁移前自动备份 DB 文件；只支持线性升级 |

---

## 9. 落地顺序

| 里程碑 | 内容 | 出口判据 |
| --- | --- | --- |
| M1 | leases 表 + LeaseService | AC1、AC2 |
| M2 | memories scope + 检索过滤 + 迁移 | AC3、AC4、AC6 |
| M3 | workspaces 实体化 + Resolver 接管路径 | 全部工具经 Resolver，无直连路径 |
| M4 | agent_versions + agent_instances | AC5、AC7 |
| M5 | Journal + 快照/回滚 | AC8 |
| M6 | closeout job | AC9、AC10 |

M1、M2 可以先做，因为它们**不改数据语义**（只加约束与过滤），风险最低且能立刻验证隔离。

---

## 10. 待决

**10.1 租约 TTL**
建议 15 分钟心跳 / 30 分钟过期。定太短会误杀长任务，定太长崩了卡门。需要实测长任务的典型时长后定。

**10.2 记忆归属的初始判定**
建议一律 `workspace`，晋升靠人。代价是「越用越懂你」变慢。是否允许「高置信度的通用条目自动升 global」需要产品决策——我倾向不允许，误判代价不对称。

**10.3 分身数量上限**
建议第一版 2–3。数量与并发写、模型成本、排障复杂度正相关。

**10.4 是否保留「双写」过渡期**
`tasks.working_dir` 与 `tasks.workspace_id` 并存一段时间便于回退，代价是两处可能不一致。建议保留一个版本周期，加启动期一致性校验。
