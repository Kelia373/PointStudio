// runtime/registry —— 唯一注册表：Page / Slot / Override / Router。
//
// 零 React 依赖：本层只存组件引用（unknown），不 import React；
// 渲染侧通过 useSyncExternalStore(subscribe, getVersion) 订阅变更。
// 插件注册的一切都返回 Disposer，由宿主按 pluginId 归集，禁用插件时一键清空。

export type Disposer = () => void

export interface PageDef {
  id: string
  title: string
  icon?: string
  order?: number
  defaultPinned?: boolean
  /** 组件引用由调用方传入，本层不做任何渲染假设。 */
  component: unknown
}

export interface PageEntry {
  pluginId: string
  def: PageDef
}

export interface SlotEntry {
  pluginId: string
  component: unknown
  order: number
}

export interface OverrideEntry {
  pluginId: string
  component: unknown
}

export interface RouterDef {
  id: string
  label: string
  decide?: unknown
  onOutcome?: unknown
}

export interface RouterEntry {
  pluginId: string
  def: RouterDef
}

const DEFAULT_ORDER = 100
/** 判定窗口：5 分钟内 */
const QUARANTINE_WINDOW_MS = 5 * 60 * 1000
/** 连报几次隔离 */
const QUARANTINE_THRESHOLD = 3

export class ComponentRegistry {
  private readonly pages: PageEntry[] = []
  private readonly slots = new Map<string, SlotEntry[]>()
  private readonly overrides = new Map<string, OverrideEntry[]>()
  private readonly routers = new Map<string, RouterEntry>()
  private readonly disposers = new Map<string, Disposer[]>()
  private readonly errorTimes = new Map<string, number[]>()
  private readonly quarantined = new Set<string>()
  private readonly listeners = new Set<() => void>()
  private readonly now: () => number
  private version = 0

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  // ---------------------------------------------------------------- Page

  registerPage(pluginId: string, def: PageDef): Disposer {
    const entry: PageEntry = { pluginId, def }
    this.pages.push(entry)
    this.bump()

    return this.track(pluginId, () => {
      const index = this.pages.indexOf(entry)
      if (index >= 0) {
        this.pages.splice(index, 1)
      }
    })
  }

  getPages(): PageEntry[] {
    return this.pages
      .map((entry, index) => ({ entry, index }))
      .sort(
        (a, b) =>
          (a.entry.def.order ?? DEFAULT_ORDER) - (b.entry.def.order ?? DEFAULT_ORDER) ||
          a.index - b.index
      )
      .map((item) => item.entry)
  }

  getPage(id: string): PageEntry | null {
    return this.pages.find((entry) => entry.def.id === id) ?? null
  }

  // ---------------------------------------------------------------- Slot

  registerSlot(pluginId: string, slotName: string, component: unknown, order = DEFAULT_ORDER): Disposer {
    const entry: SlotEntry = { pluginId, component, order }
    const list = this.slots.get(slotName) ?? []
    list.push(entry)
    this.slots.set(slotName, list)
    this.bump()

    return this.track(pluginId, () => {
      const current = this.slots.get(slotName)
      if (!current) {
        return
      }
      const index = current.indexOf(entry)
      if (index >= 0) {
        current.splice(index, 1)
      }
      if (current.length === 0) {
        this.slots.delete(slotName)
      }
    })
  }

  /** 按 order 升序；同 order 保持注册先后。 */
  getSlot(slotName: string): SlotEntry[] {
    const list = this.slots.get(slotName)
    return list ? list.slice().sort((a, b) => a.order - b.order) : []
  }

  // ------------------------------------------------------------ Override

  overrideComponent(pluginId: string, key: string, component: unknown): Disposer {
    const entry: OverrideEntry = { pluginId, component }
    const stack = this.overrides.get(key) ?? []
    stack.push(entry)
    this.overrides.set(key, stack)
    this.bump()

    return this.track(pluginId, () => {
      const current = this.overrides.get(key)
      if (!current) {
        return
      }
      const index = current.indexOf(entry)
      if (index >= 0) {
        current.splice(index, 1)
      }
      if (current.length === 0) {
        this.overrides.delete(key)
      }
    })
  }

  /** 栈顶生效；无覆盖时返回 null，渲染侧据此回退内置组件。 */
  getOverride(key: string): OverrideEntry | null {
    const stack = this.overrides.get(key)
    return stack && stack.length > 0 ? stack[stack.length - 1] : null
  }

  // -------------------------------------------------------------- Router

  registerRouter(pluginId: string, def: RouterDef): Disposer {
    this.routers.set(def.id, { pluginId, def })
    this.bump()

    return this.track(pluginId, () => {
      const current = this.routers.get(def.id)
      if (current && current.pluginId === pluginId) {
        this.routers.delete(def.id)
      }
    })
  }

  getRouters(): RouterEntry[] {
    return [...this.routers.values()]
  }

  // ------------------------------------------------------------- 故障隔离

  /**
   * 记录一次插件运行期异常。窗口内累计到阈值就隔离并剥离它注册的一切，
   * 保证「插件崩了，宿主与内置组件照常工作」。
   */
  reportError(pluginId: string, error: unknown): void {
    const now = this.now()
    const recent = (this.errorTimes.get(pluginId) ?? []).filter((at) => now - at < QUARANTINE_WINDOW_MS)
    recent.push(now)
    this.errorTimes.set(pluginId, recent)

    // error 目前只用于预留诊断；不落盘、不外发。
    void error

    if (recent.length >= QUARANTINE_THRESHOLD && !this.quarantined.has(pluginId)) {
      this.quarantined.add(pluginId)
      this.disposePlugin(pluginId)
    }
  }

  isQuarantined(pluginId: string): boolean {
    return this.quarantined.has(pluginId)
  }

  // ------------------------------------------------------------- 生命周期

  /** 逆序执行该插件名下的全部 Disposer，然后清空记录。 */
  disposePlugin(pluginId: string): void {
    const list = this.disposers.get(pluginId)
    if (!list || list.length === 0) {
      return
    }
    for (const disposer of list.slice().reverse()) {
      disposer()
    }
    this.disposers.delete(pluginId)
    this.bump()
  }

  subscribe(listener: () => void): Disposer {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 快照版本号：useSyncExternalStore 要求 getSnapshot 返回稳定值。 */
  getVersion(): number {
    return this.version
  }

  // ---------------------------------------------------------------- 内部

  private track(pluginId: string, dispose: () => void): Disposer {
    let done = false
    const disposer: Disposer = () => {
      if (done) {
        return
      }
      done = true
      dispose()

      const list = this.disposers.get(pluginId)
      if (list) {
        const index = list.indexOf(disposer)
        if (index >= 0) {
          list.splice(index, 1)
        }
        if (list.length === 0) {
          this.disposers.delete(pluginId)
        }
      }
      this.bump()
    }

    const list = this.disposers.get(pluginId) ?? []
    list.push(disposer)
    this.disposers.set(pluginId, list)
    return disposer
  }

  private bump(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }
}

/** 应用内单例；测试要隔离时自行 new ComponentRegistry()。 */
export const registry = new ComponentRegistry()
