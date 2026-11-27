// ai/domain/chunking —— 把文本切成可检索的块。
//
// RAG 的第一步。这里只做「怎么切」，不碰向量、不碰文件。
//
// 三条规矩：
// 1. 块按原文连续切片，不丢字、不重复——否则引用回原文时对不上；
// 2. 尽量在自然边界（段落 → 换行 → 句号 → 空格）断开，少把一句话劈两半；
// 3. 不产生纯空白块。纯空白跟着上一块走，保证拼接仍等于原文。

export interface ChunkOptions {
  /** 每块最大码点数。 */
  maxChars: number
}

export interface TextChunk {
  index: number
  text: string
  /** 在原文中的起止位置（便于回指与高亮）。 */
  start: number
  end: number
}

export const DEFAULT_CHUNK_CHARS = 600

/** 从强到弱的断句标记；命中越靠前越优先。 */
const BREAK_MARKERS = ['\n\n', '\n', '。', '！', '？', '；', '. ', '! ', '? ', ' ']

export function chunkText(text: string, options: ChunkOptions = { maxChars: DEFAULT_CHUNK_CHARS }): TextChunk[] {
  const maxChars = options.maxChars
  if (!Number.isInteger(maxChars) || maxChars < 1) {
    throw new RangeError(`maxChars 必须是 >= 1 的整数，收到 ${maxChars}`)
  }
  if (text.trim() === '') {
    return []
  }

  const codePoints = Array.from(text)
  const chunks: TextChunk[] = []
  let cursor = 0

  while (cursor < codePoints.length) {
    let end = Math.min(cursor + maxChars, codePoints.length)

    if (end < codePoints.length) {
      const window = codePoints.slice(cursor, end).join('')
      const breakAt = findBreak(window)
      if (breakAt > 0) {
        end = cursor + breakAt
      }
    }

    const piece = codePoints.slice(cursor, end).join('')

    // 纯空白块并进上一块，保证拼接等于原文。
    if (piece.trim() === '') {
      if (chunks.length > 0) {
        const last = chunks[chunks.length - 1]
        last.text += piece
        last.end = end
      }
      // 开头的纯空白直接跳过（不影响正文引用）。
      cursor = end
      continue
    }

    chunks.push({ index: chunks.length, text: piece, start: cursor, end })
    cursor = end
  }

  return chunks
}

/** 在窗口里找最靠后的自然边界；找不到返回 0（表示硬切）。 */
function findBreak(window: string): number {
  const chars = Array.from(window)
  for (const marker of BREAK_MARKERS) {
    const position = window.lastIndexOf(marker)
    if (position > 0) {
      // 换到码点坐标：marker 可能多字符，但都是 ASCII/单字符，直接按字面长度偏移。
      const beforeMarker = Array.from(window.slice(0, position)).length
      const markerLength = Array.from(marker).length
      const cut = beforeMarker + markerLength
      if (cut > 0 && cut <= chars.length) {
        return cut
      }
    }
  }
  return 0
}
