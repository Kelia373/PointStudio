// services/crashLogService —— 把崩溃报告写到本地并轮转。
//
// 个人版红线：报告只在本机。所以这里没有网络，只有文件。
// IO 通过端口注入（writeFile / listFiles / removeFile），因此可单测。
//
// 两条容错取向：
// 1. 写失败要如实返回错误码，但不抛——记录崩溃日志这件事不该再引发一次崩溃；
// 2. 清理旧报告失败时保留现场，新报告已经写成，不因清理失败而回退。
import { buildCrashReport, serializeCrashReport } from '../ai/domain/crashReport.ts'

export type ServiceResult<T> = { ok: true; value: T } | { ok: false; errors: string[] }

export interface CrashEnvironmentInfo {
  appVersion: string
  platform: string
  arch: string
  electronVersion: string
}

export interface CrashLogPorts {
  now: () => string
  env: CrashEnvironmentInfo
  writeFile: (fileName: string, content: string) => Promise<void>
  listFiles: () => Promise<string[]>
  removeFile: (fileName: string) => Promise<void>
}

export interface CrashLogOptions {
  /** 最多保留几份报告，默认 10。 */
  maxReports?: number
}

const FILE_PREFIX = 'crash-'

/** ISO 时间戳转文件名安全形式：去掉冒号与点，保留可排序性。 */
export function toCrashFileName(isoTimestamp: string): string {
  return `${FILE_PREFIX}${isoTimestamp.replace(/[:.]/g, '-')}.json`
}

export async function recordCrash(
  error: Error,
  context: Record<string, unknown>,
  ports: CrashLogPorts,
  options: CrashLogOptions = {}
): Promise<ServiceResult<{ file: string }>> {
  const now = ports.now()
  const report = buildCrashReport(
    { error, context },
    {
      now,
      appVersion: ports.env.appVersion,
      platform: ports.env.platform,
      arch: ports.env.arch,
      electronVersion: ports.env.electronVersion
    }
  )

  const file = toCrashFileName(now)
  try {
    await ports.writeFile(file, serializeCrashReport(report))
  } catch {
    return { ok: false, errors: ['E_CRASH_LOG_WRITE_FAILED'] }
  }

  // 轮转是"锦上添花"：失败只留下旧报告，不影响这次记录。
  const maxReports = Math.max(1, options.maxReports ?? 10)
  try {
    const files = (await ports.listFiles())
      .filter((name) => name.startsWith(FILE_PREFIX))
      .sort()
    const excess = files.length - maxReports
    for (let index = 0; index < excess; index += 1) {
      await ports.removeFile(files[index])
    }
  } catch {
    // 有意忽略：报告已经写成，清理失败不改变成功状态。
  }

  return { ok: true, value: { file } }
}
