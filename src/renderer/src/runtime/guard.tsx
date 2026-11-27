// runtime/guard —— 插件的渲染边界：崩了只降级它自己，绝不白屏。
//
// 用 Class 组件是因为 React 只有 getDerivedStateFromError / componentDidCatch
// 能接住子树渲染异常；函数组件没有等价能力。
import { Component, type ErrorInfo, type ReactNode } from 'react'

import { registry as defaultRegistry, type ComponentRegistry } from './registry'

export interface PluginErrorBoundaryProps {
  pluginId: string
  /** 抛错时渲染什么；缺省 null（插槽里的插件项直接消失）。 */
  fallback?: ReactNode
  onError?: (error: Error) => void
  children: ReactNode
  /** 便于测试注入独立注册表。 */
  registry?: ComponentRegistry
}

interface PluginErrorBoundaryState {
  failed: boolean
}

export class PluginErrorBoundary extends Component<PluginErrorBoundaryProps, PluginErrorBoundaryState> {
  state: PluginErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): PluginErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const registry = this.props.registry ?? defaultRegistry
    registry.reportError(this.props.pluginId, error)
    this.props.onError?.(error)
  }

  render(): ReactNode {
    if (this.state.failed) {
      return this.props.fallback ?? null
    }
    return this.props.children
  }
}
