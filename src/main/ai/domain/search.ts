// ai/domain/search —— 朴素关键词检索（无依赖，可替换）。
//
// 目标不是"效果最好"，而是先把「回答能附来源」这条链路走通：
// 输入查询 + 已切块的文本，输出带分数与来源的命中列表。
//
// 为什么不用向量库：那需要额外依赖与 embedding 服务。等真正需要语义召回时，
// 替换本文件的打分函数即可，调用方（chunk → search → 拼进上下文）不用动。
//
// 中文没有空格，这里用**二元组**切词：'你好世界' → 你好/好世/世界。
// 简单，但对「工作台」「计划」这类词足够用，且不依赖分词词典。

export interface SearchableChunk {
  id: string
  text: string
  /** 来源标识，例如文件路径或会话 id，用于引用回原文。 */
  source: string
}

export interface SearchHit {
  chunk: SearchableChunk
  score: number
  /** 命中的查询词，供界面高亮。 */
  matchedTerms: string[]
}

export interface SearchOptions {
  limit?: number
  /** 命中出现在开头这么多字符内时额外加权（默认 120）。 */
  proximityChars?: number
}

const CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/
const CJK_RUN = /[\u3400-\u9FFF\uF900-\uFAFF]+/

/** 切词：中文按二元组，拉丁字母数字按单词（统一小写）。 */
export function tokenize(text: string): string[] {
  const terms: string[] = []
  const lower = text.toLowerCase()

  for (const match of lower.matchAll(new RegExp(`${CJK_RUN.source}|[a-z0-9_]+`, 'g'))) {
    const piece = match[0]
    if (CJK.test(piece)) {
      const chars = Array.from(piece)
      if (chars.length === 1) {
        terms.push(chars[0])
      } else {
        for (let index = 0; index < chars.length - 1; index += 1) {
          terms.push(`${chars[index]}${chars[index + 1]}`)
        }
      }
    } else if (piece.length >= 2) {
      terms.push(piece)
    }
  }

  return terms
}

function countOccurrences(haystack: string, needle: string): { count: number; first: number } {
  if (needle === '') {
    return { count: 0, first: -1 }
  }
  let count = 0
  let first = -1
  let index = haystack.indexOf(needle)
  while (index >= 0) {
    if (first < 0) {
      first = index
    }
    count += 1
    index = haystack.indexOf(needle, index + needle.length)
  }
  return { count, first }
}

export function searchChunks(
  query: string,
  chunks: SearchableChunk[],
  options: SearchOptions = {}
): SearchHit[] {
  const terms = [...new Set(tokenize(query))]
  if (terms.length === 0 || chunks.length === 0) {
    return []
  }

  const limit = options.limit ?? 10
  const proximityChars = options.proximityChars ?? 120
  const hits: SearchHit[] = []

  for (const chunk of chunks) {
    const haystack = chunk.text.toLowerCase()
    let score = 0
    const matchedTerms: string[] = []

    for (const term of terms) {
      const { count, first } = countOccurrences(haystack, term)
      if (count === 0) {
        continue
      }
      matchedTerms.push(term)
      // 词频为主；出现在开头附近时略加分，避免"同一句铺垫"的块压过正文。
      score += count * 2
      if (first >= 0 && first < proximityChars) {
        score += 1
      }
    }

    if (matchedTerms.length > 0) {
      hits.push({ chunk, score, matchedTerms })
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id))
    .slice(0, limit)
}
