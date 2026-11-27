// services/streamRegistry —— 在途流式请求的登记表，用于「停止生成」。
//
// 为什么需要它：取消依赖 AbortController，而控制器必须能被 IPC 的另一头
// （用户的停止按钮）找到。按请求 id 登记，是最小且够用的做法。
//
// 两条纪律：
// - 正常收尾必须 dispose，否则表会随着对话无限增长；
// - dispose 与 cancel 分开：收尾不该把信号置为已中断（那会让调用方以为用户取消了）。
export interface StreamHandle {
  id: string
  signal: AbortSignal
}

export class StreamRegistry {
  private readonly controllers = new Map<string, AbortController>()

  create(id: string = crypto.randomUUID()): StreamHandle {
    const controller = new AbortController()
    this.controllers.set(id, controller)
    return { id, signal: controller.signal }
  }

  /** 用户主动停止：返回是否命中。 */
  cancel(id: string): boolean {
    const controller = this.controllers.get(id)
    if (!controller) {
      return false
    }
    controller.abort()
    this.controllers.delete(id)
    return true
  }

  /** 正常收尾：只清理登记，不改信号状态。 */
  dispose(id: string): void {
    this.controllers.delete(id)
  }

  size(): number {
    return this.controllers.size
  }
}
