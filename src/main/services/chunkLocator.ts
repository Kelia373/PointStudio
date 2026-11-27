// services/chunkLocator —— 按块序号回到原文定位。
//
// 背景：引用里存的是 `path#index`（见检索的块 id）。要让用户"点开看看原文那段"，
// 必须能按同样的切块规则重新切一次并取出对应块——不能靠字符偏移，因为文件可能被改过。
//
// 取向：**对不上就返回 null**，不猜一个"最近的"块。猜错比不显示更糟。
import { chunkText } from '../ai/domain/chunking.ts'

export interface ChunkId {
  path: string
  index: number
}

export function parseChunkId(chunkId: string): ChunkId | null {
  const hash = chunkId.lastIndexOf('#')
  if (hash <= 0) {
    return null
  }
  const path = chunkId.slice(0, hash)
  const rawIndex = chunkId.slice(hash + 1)
  if (!/^\d+$/.test(rawIndex)) {
    return null
  }
  return { path, index: Number(rawIndex) }
}

export interface LocatedChunk {
  text: string
  start: number
  end: number
}

export function locateChunk(
  content: string,
  index: number,
  chunkChars: number
): LocatedChunk | null {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`块序号必须是非负整数，收到 ${index}`)
  }
  if (!Number.isInteger(chunkChars) || chunkChars < 1) {
    throw new RangeError(`块长度必须是正整数，收到 ${chunkChars}`)
  }

  const chunks = chunkText(content, { maxChars: chunkChars })
  const target = chunks.find((chunk) => chunk.index === index)
  if (!target) {
    return null
  }
  return { text: target.text, start: target.start, end: target.end }
}
