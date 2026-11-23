// JS 测试总入口：每加一个 *.test.ts 就在这里挂一行 import。
//
// 为什么不用 `node --test`：本仓库所在目录被 ACL 加固，node 的测试运行器
// 需要为每个文件 spawn 子进程，会直接 EPERM 失败（见 AGENTS.md「本机环境事实」）。
// 直接 `node 某个文件` 是单进程执行，不 spawn，因此可用。
import './chat.test.ts'
