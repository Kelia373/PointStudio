// store/rafBatcher —— 流式 chunk 的帧合并器。
//
// 主进程每个 token 都可能推一次 chat:chunk，直接 setState 会一秒重绘几十次。
// 这里把同一帧内到达的 chunk 先拼进缓冲区，每个动画帧最多上报一次。
// 纯逻辑，不碰 DOM：schedule 可注入，测试用受控假调度器。

export type FlushHandler = (batched: Map<string, string>) => void
export type Scheduler = (callback: () => void) => unknown

export interface RafBatcherOptions {
  onFlush: FlushHandler
  /** 默认 requestAnimationFrame；测试注入受控实现。 */
  schedule?: Scheduler
}

export interface RafBatcher {
  /** 追加一段 chunk；同一 id 在本帧内会拼接。 */
  push(id: string, chunk: string): void
  /** 立即同步冲刷（chat:done / chat:error 时用，避免最后几个字迟到）。 */
  flushNow(): void
  /** 丢弃该 id 的缓冲（用户中止时用）。 */
  clear(id: string): void
  /** 是否还有未上报的缓冲。 */
  hasPending(): boolean
}

const defaultSchedule: Scheduler = (callback) => {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(() => callback())
  }
  return setTimeout(callback, 16)
}

export function createRafBatcher(options: RafBatcherOptions): RafBatcher {
  const schedule = options.schedule ?? defaultSchedule
  let buffer = new Map<string, string>()
  let scheduled = false

  function take(): Map<string, string> | null {
    if (buffer.size === 0) {
      return null
    }
    const batched = buffer
    buffer = new Map()
    return batched
  }

  function flush(): void {
    scheduled = false
    const batched = take()
    if (batched) {
      options.onFlush(batched)
    }
  }

  return {
    push(id, chunk) {
      buffer.set(id, (buffer.get(id) ?? '') + chunk)
      if (!scheduled) {
        scheduled = true
        schedule(flush)
      }
    },
    flushNow() {
      // 已排队的帧回调之后仍会执行，届时缓冲为空，take() 返回 null，不会重复上报。
      scheduled = false
      const batched = take()
      if (batched) {
        options.onFlush(batched)
      }
    },
    clear(id) {
      buffer.delete(id)
    },
    hasPending() {
      return buffer.size > 0
    }
  }
}
