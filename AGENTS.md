# AGENTS.md

PointStudio 是一个 AI 工作台，个人版与企业版共用同一内核。

本文件只写**可判定的短规则**和**AI 自己查不到的事实**（命令、路径、边界）。每条一句话，细节一律在 `docs/`，读哪份见文末索引。不放任务、进展、阶段性说明。

## 硬约束

1. **先定级再动手**：按 `docs/02` 定 L0–L4，L2 以上先出书面计划（改什么 / 不改什么 / 怎么验收），人确认后再写码。
2. **契约优先**：动 auth、金额、权限、审计、数据库迁移，先写测试并**看到它红**。
3. **不改断言迁就实现**：要改就单独一次提交，并说明原断言为什么错。
4. **`ref/` 只读**：`D:\Project\NewGame\ai-workstation\ref\` 不属于本仓库，不读不改不提交；抄结构可以，抄代码不行。
5. **不新增运行时依赖**：先写 ADR 并由人确认。
6. **不绕钩子**：禁止 `git commit --no-verify`。
7. **卡住就停**：同一测试三次不绿，或实现开始加特判/兼容分支/吞异常 → 回到计划。
8. **不问就开始干算违规**：判据见下一节。
9. **`docs/` 编号文档上限 5 个**：写满就改进现有文档，不新开编号。
10. **不直接提交 `master`**：走分支 + PR，CI「TDD 门禁」绿灯才可 squash 合并；`master` 受保护。详见 `docs/01` §3。

## 何时问

**判据只有一条：这个答案会不会改变我接下来怎么做。** 会 → 问；不会 → 直接做并标注假设。

- **必问**：两种以上合理解释且影响产出 / 触碰承重契约 / 字面要求与目标冲突 / 需要凭据或会产生花钱、外发。
- **不必问**：可逆小事 / 读代码或跑一条命令就能消歧 / 本会话已答过 / 答案不改变任何决定。
- 答「你看着办」→ 按推荐项执行，并在交付时写明这条假设。

## 开场协议（L2 及以上）

第一条回复**只能是计划**，五段不缺：目标复述 / 我的假设 / 分步计划（每步带判据）/ 要动的文件 / 待确认问题（≤2 个，带推荐项）。

该回复内不调用任何写文件或改动型命令，发完就停。中途计划失效，回第 1 步重出，不硬推。L0/L1 说一句「我打算怎么做」即可。

## 命令

```bash
bash scripts/install-hooks.sh          # 每个 clone 跑一次
python scripts/tdd_gate.py --check     # 只查暂存区
python scripts/tdd_gate.py --all       # 内容检查 + 全部测试（CI 跑这个）
```

```powershell
powershell -File scripts\dev.ps1       # 开发模式（或双击 dev.cmd）
powershell -File scripts\build.ps1     # 构建，产物在 out/
powershell -File scripts\check.ps1     # tsc + 门禁
```

本机解释器（没有 `python3`，那是商店假壳）：
`C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\python\python.exe`

本机 pnpm（不在 PATH）：
`node C:\Users\Administrator\.dsh\dsh-runtimes\dsh-next-primary-runtime\dependencies\pnpm\bin\pnpm.mjs`

## 本机环境事实

- **依赖在工作区外**：实体在 `D:\deveTools\ps-node`，工作区里的 `node_modules` 是指向它的 junction。**改完 `package.json` 的依赖要同步过去再 install。**
- **工作区目录会让其中的 exe 静默失败**（无输出、退出码 0、不执行）。判断：`icacls <目录>` 有没有 `S-1-4-`。别再用"文件损坏/签名/环境变量"解释它。
- 跑 electron 前清 `ELECTRON_RUN_AS_NODE`（DSH 会注入），否则报 `whenReady` undefined。
- electron 二进制可能缺失，需在包目录 `node install.js`，带 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。
- **AI 无法启动 Electron 窗口**，只能验证构建产物与 `tsc --noEmit`；窗口必须人开终端确认。
- PowerShell 拦 `.ps1`：用 `.CMD` 后缀或 `bash`；改执行策略由人做。
- **含中文的 `.ps1` 必须存成 UTF-8 BOM**：PowerShell 5.1 在无 BOM 时按系统 ANSI(GBK) 解码 UTF-8 字节，中文注释会把**下一行代码吃掉**，报错却指向再下一行（表现为莫名其妙的 null 参数）。已踩：`scripts/dev.ps1`。
- TS 7 移除了 `baseUrl`，`paths` 写相对路径。
- 改主进程要手动重启 dev；改界面热更新可用。这些细节见 `docs/03` §6。

## 目录与边界

| 路径 | 作用 |
| --- | --- |
| `src/main/` | 主进程与内核目录：`core` `ipc` `data` `ai` `features` `services` `utils` `i18n` `policy` `remote` `ui`（内核禁依赖 UI） |
| `docs/` | 规则、ADR、盘点（编号上限 5 个） |
| `scripts/` | 构建与检查脚本；根目录 `dev.cmd` 是双击启动入口 |
| `D:\Project\NewGame\ai-workstation\ref\` | 外部参考源码，**只读** |

## 交付格式

改了哪些文件 / 跑了哪些检查及结果 / 没跑什么 / 剩余风险。不写「应该没问题」。

## 索引

| 场景 | 读 |
| --- | --- |
| 分支合并、提交流程、测试契约、自检、停止条件 | `docs/01` |
| 任务分级、计划六问、澄清预算、阶段出口 | `docs/02` |
| 产品能力清单、模块归属、里程碑与验收判据 | `docs/04` |
| 个人版 / 企业版边界与不做清单 | `docs/00` |
| 环境坑、能力盘点、能力缺口 | `docs/03` |
| 包分层、依赖方向、新能力归位 | `docs/references/architecture/main-architecture.md` |
| 技术栈与双版本架构 | `docs/adr/0002` |

优先级：本文件 > `docs/` > 现存同类代码 > 问人。
