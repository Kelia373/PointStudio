// ai/domain/crashReport —— 崩溃报告的内容构造与脱敏。
//
// 个人版的红线：报告**只在本机生成**，用户手动导出才可能外传。
// 因此这里不做网络、不写文件，只负责「报告里能放什么、不能放什么」。
//
// 脱敏不是可选项：崩溃现场的 message / stack / context 里很容易夹着
// API Key、Bearer 令牌、用户数据。一句「应该不会」等于把凭据发给下一个人。

export const CRASH_REPORT_VERSION = 1
export const MAX_STACK_CHARS = 4_000
export const MAX_CONTEXT_CHARS = 2_000

export interface CrashEnvironment {
  now: string
  appVersion: string
  platform: string
  arch: string
  electronVersion: string
}

export interface CrashReport {
  version: number
  generatedAt: string
  appVersion: string
  platform: string
  arch: string
  electronVersion: string
  error: { name: string; message: string; stack?: string }
  context?: Record<string, unknown>
}

/** 敏感字段名：命中的值一律替换，不保留任何前缀。 */
const SENSITIVE_KEYS = [
  'apikey',
  'api_key',
  'key',
  'token',
  'accesstoken',
  'access_token',
  'password',
  'passwd',
  'secret',
  'authorization',
  'cookie',
  'credential'
]

const PATTERNS: Array<[RegExp, string]> = [
  // sk-xxxx 形式的 API Key
  [/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***'],
  // Bearer 令牌
  [/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer ***'],
  // 形如 token=xxxx / password=xxxx 的查询串
  [/\b(token|password|secret|api_?key)=[^&\s]+/gi, '$1=***']
]

export function redactText(input: string): string {
  let output = input
  for (const [pattern, replacement] of PATTERNS) {
    output = output.replace(pattern, replacement)
  }
  return output
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase()
  return SENSITIVE_KEYS.some((candidate) => normalized.includes(candidate))
}

/** 递归脱敏任意结构；保持结构形状（便于诊断），只替换值。 */
function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 5) {
    return '[truncated]'
  }
  if (typeof value === 'string') {
    return redactText(value)
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1))
  }
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = isSensitiveKey(key) ? '***' : redactValue(item, depth + 1)
    }
    return output
  }
  return value
}

export function buildCrashReport(
  input: { error: Error; context?: Record<string, unknown> },
  env: CrashEnvironment
): CrashReport {
  const stack = input.error.stack ? redactText(Array.from(input.error.stack).slice(0, MAX_STACK_CHARS).join('')) : undefined

  const report: CrashReport = {
    version: CRASH_REPORT_VERSION,
    generatedAt: env.now,
    appVersion: env.appVersion,
    platform: env.platform,
    arch: env.arch,
    electronVersion: env.electronVersion,
    error: {
      name: input.error.name,
      message: redactText(input.error.message),
      ...(stack ? { stack } : {})
    }
  }

  if (input.context) {
    const redacted = redactValue(input.context) as Record<string, unknown>
    let text = JSON.stringify(redacted)
    if (text.length > MAX_CONTEXT_CHARS) {
      // 超长就直接丢结构化上下文：报告再大也不能拿隐私换完整度。
      text = JSON.stringify({ truncated: true, reason: 'context too large' })
    }
    report.context = JSON.parse(text) as Record<string, unknown>
  }

  return report
}

export function serializeCrashReport(report: CrashReport): string {
  // 兜底：即使调用方塞了循环引用，也不能让「生成崩溃报告」这件事自己崩。
  const seen = new WeakSet<object>()
  return JSON.stringify(report, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[circular]'
      }
      seen.add(value)
    }
    return value
  })
}
