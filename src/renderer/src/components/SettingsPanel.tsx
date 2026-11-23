// 模型凭据设置。最简可用版：录入 → 保存 → 显示脱敏结果。
//
// 明文 Key 只会从输入框流向主进程；读回来永远是脱敏值（sk-x****abcd）。
// 样式是占位，等设计稿来了整体换皮。
import { useEffect, useState } from 'react'

import type { ProviderIdDto, ProviderSettingsViewDto } from '../../../shared/types/ipc.ts'

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<ProviderSettingsViewDto | null>(null)
  const [providerId, setProviderId] = useState<ProviderIdDto>('deepseek')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const current = await window.pointstudio.settings.readProvider()
      setView(current)
      setProviderId(current.providerId)
      setModel(current.model)
      setBaseUrl(current.baseUrl)
    })()
  }, [])

  async function save(): Promise<void> {
    const saved = await window.pointstudio.settings.saveProvider({
      providerId,
      apiKey,
      model: model.trim() === '' ? undefined : model.trim(),
      baseUrl: baseUrl.trim() === '' ? undefined : baseUrl.trim()
    })
    if (!saved.ok) {
      setMessage(saved.code)
      return
    }
    setView(saved.value)
    setApiKey('')
    setMessage('已保存，下一条消息就会用新凭据')
  }

  async function clear(): Promise<void> {
    const cleared = await window.pointstudio.settings.clearProvider()
    if (!cleared.ok) {
      setMessage(cleared.code)
      return
    }
    setView(await window.pointstudio.settings.readProvider())
    setMessage('已清除，将回退到环境变量或本地假流式')
  }

  return (
    <div className="settings">
      <div className="settings__row">
        <label className="settings__label" htmlFor="settings-provider">
          平台
        </label>
        <select
          id="settings-provider"
          className="settings__input"
          value={providerId}
          onChange={(event) => setProviderId(event.target.value as ProviderIdDto)}
        >
          <option value="deepseek">DeepSeek（云端，需要 Key）</option>
          <option value="ollama">Ollama（本地，免 Key）</option>
        </select>
      </div>

      <div className="settings__row">
        <label className="settings__label" htmlFor="settings-key">
          API Key
        </label>
        <input
          id="settings-key"
          className="settings__input"
          type="password"
          value={apiKey}
          placeholder={
            providerId === 'ollama'
              ? '本地模型不需要 Key（留空即可）'
              : view?.hasKey
                ? `已配置：${view.maskedKey}（留空则不变）`
                : 'sk-...'
          }
          onChange={(event) => setApiKey(event.target.value)}
        />
      </div>

      <div className="settings__row">
        <label className="settings__label" htmlFor="settings-model">
          模型
        </label>
        <input
          id="settings-model"
          className="settings__input"
          value={model}
          placeholder="deepseek-chat"
          onChange={(event) => setModel(event.target.value)}
        />
      </div>

      <div className="settings__row">
        <label className="settings__label" htmlFor="settings-base">
          接口地址
        </label>
        <input
          id="settings-base"
          className="settings__input"
          value={baseUrl}
          placeholder="https://api.deepseek.com"
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </div>

      <div className="settings__actions">
        <button className="settings__save" type="button" onClick={() => void save()}>
          保存
        </button>
        <button className="settings__clear" type="button" onClick={() => void clear()}>
          清除
        </button>
        <button className="settings__close" type="button" onClick={onClose}>
          收起
        </button>
        {message ? <span className="settings__message">{message}</span> : null}
      </div>

      <p className="settings__note">
        凭据保存在本机用户数据目录，不进仓库、不入日志；界面只显示脱敏值。
      </p>
    </div>
  )
}
