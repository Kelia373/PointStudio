// 内置页面注册：内置功能与插件走同一张表（ADR 0007 的硬规则）。
import { registry } from './registry'

function Placeholder({ title }: { title: string }) {
  return (
    <div className="page-placeholder">
      <h2 className="page-placeholder__title">{title}</h2>
      <p className="page-placeholder__hint">这一页还没接内容，先占位。</p>
    </div>
  )
}

let registered = false

/** 幂等：热更新或多次挂载都只会注册一次。 */
export function registerBuiltinPages(): void {
  if (registered) {
    return
  }
  registered = true

  registry.registerPage('builtin', {
    id: 'board',
    title: '任务看板',
    icon: 'compass',
    order: 10,
    defaultPinned: true,
    component: () => <Placeholder title="任务看板" />
  })

  registry.registerPage('builtin', {
    id: 'prompts',
    title: '提示词管理',
    icon: 'pen-line',
    order: 20,
    component: () => <Placeholder title="提示词管理" />
  })
}
