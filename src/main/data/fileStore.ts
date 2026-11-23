// data/fileStore —— 存储适配器：把一组带 id 的实体存成一个 JSON 文件。
//
// 为什么现在不是 SQLite：ADR 0002 定的是 SQLite + Drizzle，但 better-sqlite3 是
// native 模块，要在工作区外的 D:\deveTools\ps-node 重编，属于独立一步（见 data/README
// 的「现状」）。数据层的价值在**仓储接口**，适配器可换：先上零依赖的 JSON 文件，
// 把上层（services / ipc / 界面）全部打通，再换适配器，上层一行不用改。
//
// 注意：这不是「容灾级」存储。单进程、单用户、无并发写保护。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const STORE_VERSION = 1

export interface CollectionFile<T> {
  version: number
  items: T[]
}

export class JsonFileStore<T extends { id: string }> {
  private readonly filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /**
   * 读取全部。文件不存在 → 空集合；内容损坏 → 也是空集合（不崩），
   * 并且**不覆盖**原文件——写回只发生在用户真的增删改时。
   */
  async readAll(): Promise<T[]> {
    let text: string
    try {
      text = await readFile(this.filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return []
      }
      throw error
    }

    try {
      const parsed = JSON.parse(text) as Partial<CollectionFile<T>>
      return Array.isArray(parsed.items) ? parsed.items : []
    } catch {
      // 解析失败：当作空集合继续，保留现场。真正的修复交给用户/日志。
      return []
    }
  }

  /** 整体覆写。先写临时文件再 rename，避免写到一半留半截文件。 */
  async writeAll(items: T[]): Promise<void> {
    const payload: CollectionFile<T> = { version: STORE_VERSION, items }
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }
}
