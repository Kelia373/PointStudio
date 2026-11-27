// data/fileStore —— 存储适配器：把一组带 id 的实体存成一个 JSON 文件。
//
// 为什么现在不是 SQLite：ADR 0002 定的是 SQLite + Drizzle，但 better-sqlite3 是
// native 模块，要在工作区外的 D:\\deveTools\\ps-node 重编，属于独立一步（见 data/README
// 的「现状」）。数据层的价值在**仓储接口**，适配器可换：先上零依赖的 JSON 文件，
// 把上层（services / ipc / 界面）全部打通，再换适配器，上层一行不用改。
//
// 注意：这不是「容灾级」存储。单进程、单用户、无并发写保护。
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STORE_VERSION = 1

export interface CollectionFile<T> {
  version: number
  items: T[]
}

export interface JsonFileStoreOptions {
  /**
   * true（默认）：每次 writeAll 立即落盘，行为与历史版本一致。
   * false：只更新内存，200ms 尾部合并写盘；退出前必须 await flush()。
   */
  immediate?: boolean
  /** 合并窗口，默认 200ms。 */
  debounceMs?: number
}

export class JsonFileStore<T extends { id: string }> {
  private readonly filePath: string
  private readonly immediate: boolean
  private readonly debounceMs: number

  /** 首次 readAll 后驻留；也是延迟写盘的数据源。 */
  private cache: T[] | null = null
  /** 缓存对应的磁盘指纹；外部改文件（或被写坏）时用它失效缓存。 */
  private cacheStamp: { mtimeMs: number; size: number } | null = null
  private timer: NodeJS.Timeout | null = null
  private writing: Promise<void> | null = null
  private dirty = false

  constructor(filePath: string, options: JsonFileStoreOptions = {}) {
    this.filePath = filePath
    this.immediate = options.immediate ?? true
    this.debounceMs = options.debounceMs ?? 200
  }

  /**
   * 读取全部。文件不存在 → 空集合；内容损坏 → 也是空集合（不崩），
   * 并且**不覆盖**原文件——写回只发生在用户真的增删改时。
   * 命中内存缓存后不再读盘：写立刻对读可见。
   */
  async readAll(): Promise<T[]> {
    if (this.cache !== null) {
      // 有未落盘的改动时以内存为准；否则校验磁盘指纹，感知外部改动。
      if (this.dirty) {
        return this.cache
      }
      const stamp = await this.stamp()
      if (stamp !== null && this.cacheStamp !== null && stamp.mtimeMs === this.cacheStamp.mtimeMs && stamp.size === this.cacheStamp.size) {
        return this.cache
      }
    }

    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = []
        this.cacheStamp = null
        return this.cache
      }
      throw error
    }

    let items: T[]
    try {
      const parsed = JSON.parse(text) as Partial<CollectionFile<T>>
      items = Array.isArray(parsed.items) ? parsed.items : []
    } catch {
      // 解析失败：当作空集合继续，保留现场。真正的修复交给用户/日志。
      items = []
    }

    this.cache = items
    this.cacheStamp = await this.stamp()
    return items
  }

  /**
   * 整体覆写。立即更新内存（读侧零等待），再决定是马上写盘还是排队合并。
   */
  async writeAll(items: T[]): Promise<void> {
    this.cache = items
    this.dirty = true

    if (this.immediate) {
      await this.persist(items)
      return
    }
    this.schedule()
  }

  /**
   * 冲刷所有待写数据。退出前必须调用，否则最后 200ms 内的修改会丢。
   * 若已有写入在飞，等它结束后再补写一次，保证最终一致。
   */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }

    if (this.writing) {
      await this.writing
      if (this.dirty) {
        await this.flush()
      }
      return
    }

    if (!this.dirty || this.cache === null) {
      return
    }

    const items = this.cache
    this.dirty = false
    this.writing = this.persist(items).finally(() => {
      this.writing = null
    })
    await this.writing

    if (this.dirty) {
      await this.flush()
    }
  }

  private schedule(): void {
    if (this.timer !== null) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)
    // 不让定时器把进程吊住；退出时由 flush 负责兜底。
    this.timer.unref?.()
  }

  private async stamp(): Promise<{ mtimeMs: number; size: number } | null> {
    try {
      const info = await stat(this.filePath)
      return { mtimeMs: info.mtimeMs, size: info.size }
    } catch {
      return null
    }
  }

  /** 先写临时文件再 rename，避免写到一半留半截文件。 */
  private async persist(items: T[]): Promise<void> {
    const payload: CollectionFile<T> = { version: STORE_VERSION, items }
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
    this.dirty = false
    this.cacheStamp = await this.stamp()
  }
}
