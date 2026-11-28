// ipc/providers —— 多服务商凭据 / 模型发现 / 官方用量 / 本地账本的跨进程边界。
//
// 与旧 settings 通道并存：旧通道读写单行配置，这里按 providerId 一家一条。
// 明文 Key 只在主进程内使用，跨进程只回脱敏视图。
import { ipcMain } from 'electron'

import {
  PROVIDERS_CHANNELS,
  type FetchModelsResultDto,
  type IpcResult,
  type ProviderAccountViewDto,
  type ProviderUsageDto,
  type UsageLedgerSummaryDto
} from '../../shared/types/ipc.ts'
import { toAccountView } from '../ai/domain/providerAccounts.ts'
import { fetchProviderModels, fetchProviderUsage } from '../ai/providers/discovery.ts'
import type { ProviderAccountsService } from '../services/providerAccountsService.ts'
import type { UsageLedgerService } from '../services/usageLedgerService.ts'
import { isProviderAccountId, isSaveProviderAccountRequest, isUsageRange } from './validators.ts'

export interface ProvidersIpcOptions {
  accounts: ProviderAccountsService
  ledger: UsageLedgerService
  /** 测试可注入；不传用全局 fetch。 */
  fetchFn?: typeof fetch
}

export function registerProvidersIpc(options: ProvidersIpcOptions): void {
  ipcMain.handle(
    PROVIDERS_CHANNELS.listAccounts,
    async (): Promise<ProviderAccountViewDto[]> => options.accounts.listMasked()
  )

  ipcMain.handle(
    PROVIDERS_CHANNELS.saveAccount,
    async (_event, request: unknown): Promise<IpcResult<ProviderAccountViewDto>> => {
      if (!isSaveProviderAccountRequest(request)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const saved = await options.accounts.save(request)
      if (!saved.ok) {
        return { ok: false, code: saved.errors[0] ?? 'E_UNKNOWN' }
      }
      return { ok: true, value: toAccountView(saved.value) }
    }
  )

  ipcMain.handle(
    PROVIDERS_CHANNELS.clearAccount,
    async (_event, providerId: unknown): Promise<IpcResult<true>> => {
      if (!isProviderAccountId(providerId)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const cleared = await options.accounts.clear(providerId)
      return cleared.ok
        ? { ok: true, value: true }
        : { ok: false, code: cleared.errors[0] ?? 'E_UNKNOWN' }
    }
  )

  ipcMain.handle(
    PROVIDERS_CHANNELS.fetchModels,
    async (_event, providerId: unknown): Promise<IpcResult<FetchModelsResultDto>> => {
      if (!isProviderAccountId(providerId)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const account = await options.accounts.getInternal(providerId)
      if (!account) {
        return { ok: false, code: 'E_PROVIDER_NOT_CONFIGURED' }
      }
      try {
        const result = await fetchProviderModels(account, options.fetchFn ?? fetch)
        return {
          ok: true,
          value: {
            providerId,
            models: result.models,
            latencyMs: result.latencyMs,
            fetchedAt: new Date().toISOString()
          }
        }
      } catch (error) {
        console.error('[providers] 拉取模型失败', error)
        return { ok: false, code: 'E_UPSTREAM' }
      }
    }
  )

  ipcMain.handle(
    PROVIDERS_CHANNELS.fetchUsage,
    async (_event, providerId: unknown): Promise<IpcResult<ProviderUsageDto>> => {
      if (!isProviderAccountId(providerId)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const account = await options.accounts.getInternal(providerId)
      if (!account) {
        return { ok: false, code: 'E_PROVIDER_NOT_CONFIGURED' }
      }
      try {
        const usage = await fetchProviderUsage(
          account,
          options.fetchFn ?? fetch,
          new Date().toISOString()
        )
        return { ok: true, value: usage }
      } catch (error) {
        console.error('[providers] 拉取用量失败', error)
        return { ok: false, code: 'E_UPSTREAM' }
      }
    }
  )

  ipcMain.handle(
    PROVIDERS_CHANNELS.readLedger,
    async (_event, range: unknown): Promise<UsageLedgerSummaryDto> => {
      const safeRange = isUsageRange(range) ? range : '7d'
      const summary = await options.ledger.summary(safeRange)
      return {
        range: summary.range,
        totalCalls: summary.totalCalls,
        totalPromptTokens: summary.totalPromptTokens,
        totalCompletionTokens: summary.totalCompletionTokens,
        totalCacheHitTokens: summary.totalCacheHitTokens,
        totalTokens: summary.totalTokens,
        byProvider: summary.byProvider,
        byAssistant: summary.byAssistant
      }
    }
  )
}
