// runtime/SlotRenderer —— 插槽与组件覆盖的渲染入口。
//
// 统一用 useSyncExternalStore 订阅注册表版本号：插件注册/卸载后自动重渲染，
// 每个条目各自包一层 PluginErrorBoundary，坏掉一个不影响其它。
import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'

import { PluginErrorBoundary } from './guard'
import { registry as defaultRegistry, type ComponentRegistry } from './registry'

/** 订阅注册表变更；返回当前版本号。 */
export function useRegistryVersion(registry: ComponentRegistry = defaultRegistry): number {
  return useSyncExternalStore(
    (listener) => registry.subscribe(listener),
    () => registry.getVersion(),
    () => registry.getVersion()
  )
}

export interface SlotProps<P extends object = Record<string, never>> {
  name: string
  props?: P
  registry?: ComponentRegistry
}

/** 追加型插槽：按 order 依次渲染所有插件条目。 */
export function Slot<P extends object = Record<string, never>>({
  name,
  props,
  registry = defaultRegistry
}: SlotProps<P>): ReactNode {
  useRegistryVersion(registry)
  const entries = registry.getSlot(name)
  if (entries.length === 0) {
    return null
  }

  const slotProps = (props ?? {}) as P
  return (
    <>
      {entries.map((entry, index) => {
        const PluginComponent = entry.component as ComponentType<P>
        return (
          <PluginErrorBoundary
            key={`${entry.pluginId}:${name}:${index}`}
            pluginId={entry.pluginId}
            fallback={null}
            registry={registry}
          >
            <PluginComponent {...slotProps} />
          </PluginErrorBoundary>
        )
      })}
    </>
  )
}

export interface OverridableProps<P extends object> {
  name: string
  fallback: ComponentType<P>
  props: P
  registry?: ComponentRegistry
}

/** 组件覆盖：有覆盖用覆盖，覆盖抛错当场回退内置实现。 */
export function Overridable<P extends object>({
  name,
  fallback: Builtin,
  props,
  registry = defaultRegistry
}: OverridableProps<P>): ReactNode {
  useRegistryVersion(registry)
  const override = registry.getOverride(name)
  if (!override) {
    return <Builtin {...props} />
  }

  const PluginComponent = override.component as ComponentType<P>
  return (
    <PluginErrorBoundary
      pluginId={override.pluginId}
      fallback={<Builtin {...props} />}
      registry={registry}
    >
      <PluginComponent {...props} />
    </PluginErrorBoundary>
  )
}
