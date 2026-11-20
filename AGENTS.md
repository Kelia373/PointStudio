# AGENTS.md

PointStudio 是一个 AI 工作台，个人版与企业版共用同一内核。

本文件只放两样东西：**每次都必须遵守的规范**，以及 **AI 自己查不到的信息**（命令、路径、边界）。
不放任务、不放项目进展、不放阶段性说明——那些属于看板、提交信息或 `docs/`。细节规则在 `docs/`，与本文件冲突时以本文件为准。

## 硬约束

1. **先定级再动手**。按 `docs/02` 的 L0–L4 给任务定级，L2 及以上必须先出书面计划（改什么 / 不改什么 / 验收方式），人确认后再写码。
2. **契约优先**。触及 auth、金额、权限、审计、数据库迁移，先写测试并**看到它红**，再写实现。
3. **不许改断言迁就实现**。要改，单独一次提交并说明原断言为什么错。
4. **`ref/` 只读**。参考代码在 `D:\Project\NewGame\ai-workstation\ref\`，不属于本仓库；不读不改不提交，不把其中代码复制进 `apps/` `packages/`（抄结构可以，抄代码不行）。
5. **不新增运行时依赖**。除非先写 ADR 并由人确认。
6. **不绕钩子**。禁止 `git commit --no-verify`；pre-commit 已挂 `scripts/tdd_gate.py`。
7. **卡住就停**。同一测试改三次不绿、或实现开始加特判/兼容分支/吞异常，停止实现，回到计划。
8. **不许不问就开始干**。判定见下节「何时问，何时干」；L2 及以上遵守「开场协议」。
9. **`docs/` 编号文档上限 5 个**。写满即停止新增，要加内容改进现有文档，不新开编号。

## 何时问，何时干

判据只有一条——**信息价值（VoI）**：先自问「这个答案会不会改变我接下来怎么做」。不会 → 别问，直接做并标注假设；会 → 必须问，且一次只问一个维度。

**必须问**（不问就动手视为违规）：

- 有两种以上合理解释，且选择会实质改变产出；
- 触碰承重契约：对外接口、数据结构、迁移路径、权限、审计、计费；
- 你字面上的要求和你说的目标相互冲突；
- 需要凭据、生产资源、或会产生花钱/对外发送的副作用。

**不必问**（问了是浪费你时间）：

- 可逆小事：改文案、重命名局部变量、加一行日志；
- 读代码、读文档、跑一条命令就能消歧；
- 你在本会话里已经答过一次的问题；
- 答案不改变任何决定——那只是我在求安心。

被问到时若答「你看着办」，按我给出的推荐项执行，并在交付时写明这条假设。

## 开场协议（L2 及以上）

L2 及以上任务的**第一条回复只能是计划**，固定五段，一段不少：

1. **目标复述**：我理解你要什么，以及怎样算做完（可验收）；
2. **我的假设**：所有不确定处，明写成假设；
3. **分步计划**：每步带一个「怎么判断这步成了」；
4. **要动的文件**：列出来，含新增；
5. **待确认问题**：最多 2 个，每个给选项和推荐项。

该回复内**不得调用任何写文件或改动型命令**，发完就停，等人放行。放行后才开工；中途计划失效，回到第 1 步重出计划，不硬推。

区别对待：L0/L1 不必走满这套，但仍要说一句「我打算怎么做」。

## 命令

```bash
bash scripts/install-hooks.sh          # 每个 clone 跑一次，装 git 钩子
python scripts/tdd_gate.py --check     # 检查暂存区（改断言 / 豁免标记 / 吞异常）
python scripts/tdd_gate.py --test      # 跑全部测试（stdlib unittest，无第三方依赖）
python scripts/tdd_gate.py --all       # 内容 + 测试，CI 跑的就是这个
```

本机没有 `python3`（是 Windows 商店的假壳），用这个解释器：
`C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\python\python.exe`

pnpm 不在 PATH，用：
`node C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\pnpm\bin\pnpm.mjs`

## 本机环境事实（查不到，别硬猜）

**依赖与机器状态位置**：pnpm 内容仓库在 `D:\deveTools\pnpm-store`（由 `pnpm-workspace.yaml` 的 `storeDir` 指定，pnpm 11 不认 `.npmrc` 里的 `store-dir`），electron 二进制缓存在 `D:\deveTools\electron-cache`。
仓库里只放源码；`node_modules` 是模块解析硬要求，无法外置，已被 `.gitignore` 忽略。
**新增依赖时要提权**（要写 `D:` 盘外的 store）；纯 `install` 复用已有 store 时不需要：

```bash
node <pnpm.mjs> install
```

**四个坑，不知道会白折腾一轮**：

1. DSH 会话会给子进程注入 `ELECTRON_RUN_AS_NODE=1`，electron 因此被当成纯 Node 跑，报 `app.whenReady` undefined。跑 electron 前必须 `unset ELECTRON_RUN_AS_NODE`。
2. electron 二进制在本机需要手动补：在 electron 包目录内执行
   `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node install.js`
   （pnpm 会跳过 postinstall；直连 GitHub HTTPS 被阻断）。
3. **AI 无法在会话内启动 Electron 窗口**（提权后仍以 `0xC0000005` 崩溃）。窗口只能由人开终端确认，**不要声称"已验证窗口能开"**；AI 能验证的边界是构建产物与 `tsc --noEmit`。
4. **PowerShell 执行策略拦 `.ps1`**：`.\node_modules\.bin\xxx` 会报「未对文件进行数字签名」。绕法是显式带扩展名 `.\node_modules\.bin\electron-vite.CMD dev`（或用 `bash`、`cmd /c`）。长期方案 `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`，**改系统设置须人自己执行，AI 不动**。

**typescript 7 移除了 `baseUrl`**，`paths` 必须写相对路径（`./src/...`）。

## 目录与边界

| 路径 | 作用 | 权限 |
| --- | --- | --- |
| `apps/` | 可运行产物：`desktop`（个人版）、`server`（企业版） | 可改 |
| `packages/` | 内核与工具，禁止依赖 UI：`core` `agent` `providers` `tools` `policy` `storage` `remote` `ui` | 可改 |
| `docs/` | 规则、ADR、能力盘点（编号文档上限 5 个） | 可改 |
| `resources/` | 参考资料（papers / guides / screenshots / notes） | 可改 |
| `D:\Project\NewGame\ai-workstation\ref\` | 外部参考源码（cherry-studio 等） | **只读，不入库** |

## 交付格式

每次交付必须写清四件事：改了哪些文件 / 跑了哪些检查及结果 / 没跑什么 / 剩余风险。
不写「应该没问题」。

## 规则索引

| 场景 | 读 |
| --- | --- |
| 任务分级、计划六问、澄清预算、执行循环、收尾、阶段出口 | `docs/02-任务规划能力.md`、`docs/01-开发工作规则.md` |
| 改动生命周期、测试契约、提交规范、依赖选型、自检、停止条件 | `docs/01-开发工作规则.md` |
| 个人版 / 企业版边界与不做清单 | `docs/00-项目定位与边界.md` |
| 本机能力、环境坑、能力缺口 | `docs/03-能力与工具链盘点.md` |
| 技术栈与双版本架构 | `docs/adr/0002-技术栈选型与双版本架构.md` |

优先级：本文件 > `docs/` > 现存同类代码 > 问人。
