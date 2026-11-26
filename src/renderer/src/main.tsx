import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'
import { exposeRuntime } from './runtime/expose'
import './styles/tokens.css'
import './styles/app.css'

// 先挂共享运行时：插件产物从这里取同一份 React。
exposeRuntime()

const container = document.getElementById('root')
if (!container) {
  throw new Error('renderer root element #root not found')
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
