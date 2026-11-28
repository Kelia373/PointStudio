// ai/providers/discovery —— 拉取真实模型列表与官方用量。
//
// 只做「请求 + 解析 + 归一」，不碰存储：调用方（ipc/providers）决定把结果写回哪。
// fetch 可注入，单测不需要连外网。
import type {
  BalanceInfoDto,
  DiscoveredModelDto,
  ProviderUsageDto,
  QuotaWindowDto
} from '../../../shared/types/ipc.ts'
import type { ProviderAccount } from '../domain/providerAccounts.ts'
import { opencodeModelsUrl, opencodeUsageUrl } from './opencodeGo.ts'
import {
  capabilitiesForSelectable,
  inferModelCapabilities,
  rememberModelCapabilities
} from './modelCapabilities.ts'

export type FetchFn = typeof fetch

export interface FetchModelsOutcome {
  models: DiscoveredModelDto[]
  latencyMs: number
}

export interface DiscoveryDeps {
  now: () => number
}

/** 从多种可能的响应形状里取出模型条目：id + 原始元数据（能力探测要用）。 */
interface RawModelItem {
  id: string
  raw?: Record<string, unknown>
}

function extractModelItems(payload: unknown): RawModelItem[] {
  if (typeof payload !== 'object' || payload === null) {
    return []
  }
  const record = payload as Record<string, unknown>
  const list = Array.isArray(record['data'])
    ? record['data']
    : Array.isArray(record['models'])
      ? record['models']
      : []
  const items: RawModelItem[] = []
  for (const item of list) {
    if (typeof item === 'string') {
      items.push({ id: item })
      continue
    }
    if (typeof item === 'object' && item !== null) {
      const raw = item as Record<string, unknown>
      const id = raw['id']
      const name = raw['name']
      if (typeof id === 'string') {
        items.push({ id, raw })
      } else if (typeof name === 'string') {
        items.push({ id: name, raw })
      }
    }
  }
  return items
}

function modelsEndpoint(account: ProviderAccount): string {
  const baseUrl = account.baseUrl.replace(/\/+$/, '')
  if (account.protocol === 'opencode-go') {
    return opencodeModelsUrl(account.baseUrl)
  }
  if (account.protocol === 'ollama') {
    return `${baseUrl}/api/tags`
  }
  return `${baseUrl}/models`
}

/** OpenCode Go 的模型：去掉 `opencode-go/` 前缀，`-free` 标记为不可直选。 */
export function normalizeOpencodeModel(rawId: string): DiscoveredModelDto {
  const id = rawId.replace(/^opencode-go\//, '').trim()
  const free = id.endsWith('-free')
  return {
    id,
    wire: /claude/i.test(id) ? 'anthropic' : 'openai',
    selectable: !free,
    ...(free ? { note: '仅官方 OpenCode 客户端可用' } : {})
  }
}

export async function fetchProviderModels(
  account: ProviderAccount,
  fetchFn: FetchFn = fetch,
  deps: DiscoveryDeps = { now: () => Date.now() }
): Promise<FetchModelsOutcome> {
  const started = deps.now()
  const response = await fetchFn(modelsEndpoint(account), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      ...(account.apiKey.trim() === ''
        ? {}
        : { authorization: `Bearer ${account.apiKey}` })
    },
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    throw new Error(`E_HTTP_${response.status}`)
  }
  const payload = (await response.json()) as unknown
  const items = extractModelItems(payload)
  const models: DiscoveredModelDto[] = items.map((item) => {
    const base: DiscoveredModelDto =
      account.protocol === 'opencode-go'
        ? normalizeOpencodeModel(item.id)
        : { id: item.id, selectable: true }
    const capabilities = capabilitiesForSelectable(
      inferModelCapabilities(account.id, base.id, item.raw),
      base.selectable
    )
    return { ...base, capabilities }
  })
  // 记下来给发送侧用：UI 与真实参数只有一个能力来源。
  rememberModelCapabilities(account.id, models)
  return { models, latencyMs: Math.max(0, deps.now() - started) }
}

/** 官方用量：DeepSeek 余额 / OpenCode Go 配额窗口 / 其余诚实说不支持。 */
export async function fetchProviderUsage(
  account: ProviderAccount,
  fetchFn: FetchFn = fetch,
  fetchedAt = new Date().toISOString()
): Promise<ProviderUsageDto> {
  if (account.protocol === 'deepseek') {
    const baseUrl = account.baseUrl.replace(/\/+$/, '')
    const response = await fetchFn(`${baseUrl}/user/balance`, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${account.apiKey}`
      },
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) {
      throw new Error(`E_HTTP_${response.status}`)
    }
    const payload = (await response.json()) as {
      is_available?: boolean
      balance_infos?: Array<{
        currency?: string
        total_balance?: string
        granted_balance?: string
        topped_up_balance?: string
      }>
    }
    const balances: BalanceInfoDto[] = (payload.balance_infos ?? []).map((item) => ({
      currency: item.currency ?? 'CNY',
      totalBalance: item.total_balance ?? '0',
      ...(item.granted_balance !== undefined ? { grantedBalance: item.granted_balance } : {}),
      ...(item.topped_up_balance !== undefined
        ? { toppedUpBalance: item.topped_up_balance }
        : {})
    }))
    return {
      providerId: account.id,
      kind: 'balance',
      available: payload.is_available !== false,
      balances,
      fetchedAt
    }
  }

  if (account.protocol === 'opencode-go') {
    const response = await fetchFn(opencodeUsageUrl(account.baseUrl), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${account.apiKey}`,
        'user-agent': 'PointStudio/0.1'
      },
      signal: AbortSignal.timeout(10_000)
    })
    if (!response.ok) {
      throw new Error(`E_HTTP_${response.status}`)
    }
    const payload = (await response.json()) as {
      usage?: Record<string, { percent?: number; resetsAt?: string; resets_at?: string; status?: string } | null>
      data?: Record<string, unknown>
    }
    const source = payload.usage ?? payload.data ?? {}
    const windows: QuotaWindowDto[] = []
    for (const window of ['rolling', 'weekly', 'monthly'] as const) {
      const raw = (source as Record<string, unknown>)[window]
      if (typeof raw !== 'object' || raw === null) {
        continue
      }
      const record = raw as Record<string, unknown>
      const percent = typeof record['percent'] === 'number' ? record['percent'] : null
      if (percent === null) {
        continue
      }
      windows.push({
        window,
        percent,
        resetsAt:
          typeof record['resetsAt'] === 'string'
            ? record['resetsAt']
            : typeof record['resets_at'] === 'string'
              ? record['resets_at']
              : null,
        ...(typeof record['status'] === 'string' ? { status: record['status'] } : {})
      })
    }
    return {
      providerId: account.id,
      kind: 'quota-windows',
      available: true,
      windows,
      fetchedAt
    }
  }

  return {
    providerId: account.id,
    kind: 'unsupported',
    available: false,
    fetchedAt,
    note: '该服务商暂未提供官方余额查询接口，请查看下方本地 Token 账本'
  }
}
