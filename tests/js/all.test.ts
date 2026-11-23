// JS 测试总入口：每加一个测试文件就在这里挂一行 import。
//
// 两句约定：
// 1. 测试文件与实现**同目录**放在 `__tests__/` 下（参考 Cherry Studio 的组织方式），
//    好处是改一个模块时测试就在旁边，不会出现「测试目录和源码各长各的」。
// 2. 不用 `node --test`：本仓库所在目录被 ACL 加固，node 测试运行器要为每个文件
//    spawn 子进程，会直接 EPERM（见 AGENTS.md「本机环境事实」）。直跑单文件是
//    单进程执行，不 spawn。
//
// 跑法：node tests/js/all.test.ts
import '../../src/main/ai/domain/__tests__/chat.test.ts'
import '../../src/main/ai/domain/__tests__/assistant.test.ts'
import '../../src/main/ai/domain/__tests__/conversation.test.ts'
import '../../src/main/ai/domain/__tests__/providerSettings.test.ts'
import '../../src/main/ai/domain/__tests__/context.test.ts'
import '../../src/main/ai/domain/__tests__/chunking.test.ts'
import '../../src/main/ai/domain/__tests__/backup.test.ts'
import '../../src/main/ai/domain/__tests__/crashReport.test.ts'
import '../../src/main/ai/domain/__tests__/search.test.ts'
import '../../src/main/utils/__tests__/paths.test.ts'
import '../../src/shared/utils/__tests__/format.test.ts'
import '../../src/shared/types/__tests__/ipcCoverage.test.ts'
import '../../src/renderer/src/lib/__tests__/chatState.test.ts'
import '../../src/main/ai/tools/__tests__/registry.test.ts'
import '../../src/main/ai/tools/builtin/__tests__/builtinTools.test.ts'
import '../../src/main/ai/agent/__tests__/plan.test.ts'
import '../../src/main/ai/agent/__tests__/executor.test.ts'
import '../../src/main/ai/agent/__tests__/planPrompt.test.ts'
import '../../src/main/ai/providers/__tests__/deepseek.test.ts'
import '../../src/main/ai/providers/__tests__/ollama.test.ts'
import '../../src/main/ai/mcp/__tests__/client.test.ts'
import '../../src/main/ai/mcp/__tests__/httpTransport.test.ts'
import '../../src/main/services/__tests__/chatReply.test.ts'
import '../../src/main/services/__tests__/chatEngine.test.ts'
import '../../src/main/services/__tests__/assistantService.test.ts'
import '../../src/main/services/__tests__/conversationService.test.ts'
import '../../src/main/services/__tests__/chatFlow.test.ts'
import '../../src/main/services/__tests__/planService.test.ts'
import '../../src/main/services/__tests__/workspaceService.test.ts'
import '../../src/main/services/__tests__/workspaceImportService.test.ts'
import '../../src/main/services/__tests__/agentLoop.test.ts'
import '../../src/main/services/__tests__/agentRunService.test.ts'
import '../../src/main/services/__tests__/comparisonService.test.ts'
import '../../src/main/services/__tests__/mcpService.test.ts'
import '../../src/main/services/__tests__/turnService.test.ts'
import '../../src/main/services/__tests__/backupService.test.ts'
import '../../src/main/services/__tests__/crashLogService.test.ts'
import '../../src/main/services/__tests__/retrievalService.test.ts'
import '../../src/main/services/__tests__/providerSettingsService.test.ts'
