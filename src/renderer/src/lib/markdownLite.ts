// lib/markdownLite —— 副画布预览用的极小 Markdown 渲染器。
//
// 只用 textarea + 这份渲染器，不引任何第三方运行时依赖（AGENTS.md 硬约束第 5 条）。
// 支持的子集刻意很少：标题、段落、有序 / 无序列表、围栏代码块、粗体、斜体、行内代码。
// 安全边界：先转义 HTML 再做标记替换，原文里的标签永远不会变成可执行标记；
// 不支持内嵌 HTML，也就不需要额外的白名单过滤。

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 行内标记：先抽出行内代码，避免其中的 * 被当成粗体。 */
function renderInline(text: string): string {
  const codes: string[] = []
  let out = escapeHtml(text).replace(/`([^`]+)`/g, (_, code: string) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/\u0000(\d+)\u0000/g, (_, index: string) => `<code>${codes[Number(index)]}</code>`)
  return out
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let paragraph: string[] = []
  let listType: 'ul' | 'ol' | null = null
  let inCode = false
  let codeLines: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      out.push(`<p>${renderInline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const closeList = (): void => {
    if (listType !== null) {
      out.push(`</${listType}>`)
      listType = null
    }
  }

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        codeLines = []
        inCode = false
      } else {
        flushParagraph()
        closeList()
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (line.trim() === '') {
      flushParagraph()
      closeList()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushParagraph()
      closeList()
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`)
      continue
    }

    const unordered = /^\s*[-*+]\s+(.*)$/.exec(line)
    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (unordered || ordered) {
      flushParagraph()
      const type: 'ul' | 'ol' = unordered ? 'ul' : 'ol'
      if (listType !== type) {
        closeList()
        out.push(`<${type}>`)
        listType = type
      }
      out.push(`<li>${renderInline((unordered ?? ordered)![1].trim())}</li>`)
      continue
    }

    closeList()
    paragraph.push(line.trim())
  }

  // 收尾：代码块没闭合也照原样呈现，不吞掉用户的草稿
  if (inCode) {
    out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  }
  flushParagraph()
  closeList()
  return out.join('\n')
}
