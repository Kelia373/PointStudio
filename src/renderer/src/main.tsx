import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { exposeRuntime } from './runtime/expose'
import { applyTypography, parseTypography, TYPOGRAPHY_STORAGE_KEY } from './lib/typography'
import './styles/fonts.css'
import './styles/tokens.css'
import './styles/app.css'

// 先挂共享运行时：渲染层各模块从这里取同一套 React。
exposeRuntime()

// 字体在首帧之前落到根元素，避免先闪默认字体再换成用户选的。
// 解析失败 / 没存过一律回默认，脏 localStorage 不会卡住启动。
applyTypography(
  parseTypography(window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY)),
  document.documentElement
)

const container = document.getElementById('root')
if (!container) {
  throw new Error('renderer root element #root not found')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
