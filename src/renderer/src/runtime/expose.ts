// runtime/expose —— 把宿主单例挂到 window，供插件产物取用。
//
// 为什么不用 rollupOptions.external：生产构建（ESM）没有 Import Map 时，
// 浏览器解析裸模块名 'react' 会直接失败导致白屏。宿主正常打包 React，
// 再把同一个实例暴露给插件，Hooks 才是单例。

import * as React from 'react'
import * as ReactDOM from 'react-dom/client'
import * as jsxRuntime from 'react/jsx-runtime'

import { registry } from './registry'

export interface PointStudioRuntime {
  React: typeof React
  ReactDOM: typeof ReactDOM
  jsxRuntime: typeof jsxRuntime
  registry: typeof registry
}

declare global {
  interface Window {
    __POINTSTUDIO_RUNTIME__?: PointStudioRuntime
  }
}

export function exposeRuntime(): PointStudioRuntime {
  const runtime: PointStudioRuntime = { React, ReactDOM, jsxRuntime, registry }
  window.__POINTSTUDIO_RUNTIME__ = runtime
  return runtime
}
