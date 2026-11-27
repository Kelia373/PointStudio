// 全屏设置页：左栏模块导航（宽度与侧栏一致），右栏是该模块的具体设置项。
import { useEffect, useState } from 'react'

import Icon from './Icon'
import SettingsPanel from './SettingsPanel'

type ModuleKey = 'provider' | 'appearance' | 'about'

const MODULES: { key: ModuleKey; label: string }[] = [
  { key: 'provider', label: '模型与凭据' },
  { key: 'appearance', label: '外观' },
  { key: 'about', label: '关于' }
]

export default function SettingsPage({ onClose }: { onClose: () => void }) {
  const [module, setModule] = useState<ModuleKey>('provider')

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const current = MODULES.find((item) => item.key === module)

  return (
    <div className="settings-page" role="dialog" aria-modal="true" aria-label="设置">
      <div className="settings-page__side">
        <div className="settings-page__title">设置</div>
        <nav className="settings-page__nav">
          {MODULES.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-current={item.key === module}
              onClick={() => setModule(item.key)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="settings-page__main">
        <header className="settings-page__head">
          <h2>{current?.label ?? '设置'}</h2>
          <span className="topbar__spacer" />
          <button
            className="icon-btn"
            type="button"
            onClick={onClose}
            title="关闭设置"
            aria-label="关闭设置"
          >
            <Icon name="x" />
          </button>
        </header>
        <div className="settings-page__body">
          {module === 'provider' ? (
            <SettingsPanel onClose={onClose} />
          ) : (
            <p className="settings-page__hint">这一块的设置项还没接，先占位。</p>
          )}
        </div>
      </div>
    </div>
  )
}
