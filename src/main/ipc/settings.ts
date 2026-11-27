// ipc/settings —— 模型凭据的跨进程边界。
//
// 唯一的红线：明文 Key 只往主进程里进，不往外面出。
// 保存成功后把新配置回调给组合根，让引擎立刻用上新凭据（不用重启应用）。
import { ipcMain } from 'electron'

import {
  SETTINGS_CHANNELS,
  type IpcResult,
  type ProviderSettingsViewDto
} from '../../shared/types/ipc.ts'
import type { ProviderSettings } from '../ai/domain/providerSettings.ts'
import { isProviderSettingsDraft } from './validators.ts'
import type { ProviderSettingsService } from '../services/providerSettingsService.ts'


export interface SettingsIpcOptions {
  settings: ProviderSettingsService
  /** 配置变化后通知组合根刷新引擎依赖；null 表示凭据已清除。 */
  onChange: (settings: ProviderSettings | null) => void
}

export function registerSettingsIpc(options: SettingsIpcOptions): void {
  ipcMain.handle(SETTINGS_CHANNELS.readProvider, async (): Promise<ProviderSettingsViewDto> => {
    return options.settings.readMasked()
  })

  ipcMain.handle(
    SETTINGS_CHANNELS.saveProvider,
    async (_event, request: unknown): Promise<IpcResult<ProviderSettingsViewDto>> => {
      if (!isProviderSettingsDraft(request)) {
        return { ok: false, code: 'E_BAD_INPUT' }
      }
      const result = await options.settings.save(request)
      if (!result.ok) {
        return { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
      }
      options.onChange(result.value)
      return { ok: true, value: await options.settings.readMasked() }
    }
  )

  ipcMain.handle(
    SETTINGS_CHANNELS.clearProvider,
    async (): Promise<IpcResult<true>> => {
      const result = await options.settings.clear()
      if (!result.ok) {
        return { ok: false, code: result.errors[0] ?? 'E_UNKNOWN' }
      }
      options.onChange(null)
      return { ok: true, value: true }
    }
  )
}
