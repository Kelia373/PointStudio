// services/retrievalService —— 在工作区文件里检索，产出可引用的片段。
//
// 编排三件事：读文件（注入）→ 切块（ai/domain/chunking）→ 关键词检索（ai/domain/search）。
// 本层不 import fs：文件由外壳读取后传进来，因此可脱离运行环境单测。
//
// 失败策略：单个文件读不出来就跳过它，不让整个检索失败——
// 工作区里一个文件被删了，不该导致"什么都搜不到"。
import { chunkText, DEFAULT_CHUNK_CHARS } from '../ai/domain/chunking.ts'
import { searchChunks, type SearchHit, type SearchableChunk } from '../ai/domain/search.ts'
import type { WorkspaceFile } from '../ai/domain/workspace.ts'

export interface RetrievalDeps {
  readTextFile: (relativePath: string) => Promise<string>
  /** 每块码点数，默认与 chunking 的默认值一致。 */
  chunkChars?: number
  /** 最多返回多少条，默认 5——检索结果是塞进上下文的，宁少勿滥。 */
  limit?: number
}

export async function searchWorkspaceFiles(
  query: string,
  files: WorkspaceFile[],
  deps: RetrievalDeps
): Promise<SearchHit[]> {
  if (query.trim() === '' || files.length === 0) {
    return []
  }

  const chunkChars = deps.chunkChars ?? DEFAULT_CHUNK_CHARS
  const searchable: SearchableChunk[] = []

  for (const file of files) {
    let content: string
    try {
      content = await deps.readTextFile(file.path)
    } catch {
      continue
    }

    for (const chunk of chunkText(content, { maxChars: chunkChars })) {
      searchable.push({
        // id 带上文件与块序号，便于引用时定位回原文。
        id: `${file.path}#${chunk.index}`,
        text: chunk.text,
        source: file.path
      })
    }
  }

  return searchChunks(query, searchable, { limit: deps.limit ?? 5 })
}

/** 把命中片段拼成可塞进提示词的一段文本，并保留来源标注。 */
export function formatHitsForPrompt(hits: SearchHit[]): string {
  if (hits.length === 0) {
    return ''
  }
  return hits
    .map((hit, index) => `[${index + 1}] 来源：${hit.chunk.source}\n${hit.chunk.text}`)
    .join('\n\n')
}
