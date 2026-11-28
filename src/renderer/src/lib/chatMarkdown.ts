// lib/chatMarkdown —— 零依赖 Markdown 解析（块级 + 行内）。
//
// 只做聊天里真正会用到的子集：标题、段落、围栏代码块、列表、引用、表格、分隔线，
// 行内代码 / 加粗 / 斜体 / 删除线 / 安全链接。解析结果交给 React 原生渲染，
// 绝不拼 HTML 字符串，从根上避免 XSS。
export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; text: string }
  | { type: 'paragraph'; lines: string[] }
  | { type: 'code'; lang: string; code: string; closed: boolean }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'blockquote'; lines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' }

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strong'; children: InlineToken[] }
  | { type: 'em'; children: InlineToken[] }
  | { type: 'strike'; children: InlineToken[] }
  | { type: 'link'; label: string; href: string }

const SAFE_HREF = /^(https?:\/\/|mailto:)/i

function isHeading(line: string): number | null {
  const match = line.match(/^(#{1,6})\s+/)
  return match ? match[1].length : null
}

function isHr(line: string): boolean {
  return /^\s*(---+|\*\*\*+|___+)\s*$/.test(line)
}

function isQuote(line: string): boolean {
  return /^\s*>\s?/.test(line)
}

function isList(line: string): boolean {
  return /^\s*([-*+]|\d+\.)\s+/.test(line)
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-')
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

export function parseMarkdownBlocks(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    if (line.trim() === '') {
      index += 1
      continue
    }

    // 围栏代码块：未闭合时 closed=false，流式阶段也能稳定渲染。
    const fence = line.match(/^\s*```\s*([\w#+.-]*)\s*$/)
    if (fence) {
      const lang = fence[1] ?? ''
      index += 1
      const codeLines: string[] = []
      let closed = false
      while (index < lines.length) {
        if (/^\s*```\s*[\w#+.-]*\s*$/.test(lines[index])) {
          closed = true
          index += 1
          break
        }
        codeLines.push(lines[index])
        index += 1
      }
      blocks.push({ type: 'code', lang, code: codeLines.join('\n'), closed })
      continue
    }

    const headingLevel = isHeading(line)
    if (headingLevel !== null) {
      blocks.push({
        type: 'heading',
        level: headingLevel as 1 | 2 | 3 | 4 | 5 | 6,
        text: line.replace(/^#{1,6}\s+/, '').trim()
      })
      index += 1
      continue
    }

    if (isHr(line)) {
      blocks.push({ type: 'hr' })
      index += 1
      continue
    }

    if (isQuote(line)) {
      const quoteLines: string[] = []
      while (index < lines.length && isQuote(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'blockquote', lines: quoteLines })
      continue
    }

    if (isList(line)) {
      const ordered = /^\s*\d+\./.test(line)
      const items: string[] = []
      while (index < lines.length && isList(lines[index])) {
        items.push(lines[index].replace(/^\s*([-*+]|\d+\.)\s+/, ''))
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    // GFM 表格：表头 + 分隔行 + 若干行
    if (
      line.includes('|') &&
      index + 1 < lines.length &&
      isTableSeparator(lines[index + 1])
    ) {
      const headers = splitRow(line)
      index += 2
      const rows: string[][] = []
      while (index < lines.length && lines[index].includes('|') && lines[index].trim() !== '') {
        rows.push(splitRow(lines[index]))
        index += 1
      }
      blocks.push({ type: 'table', headers, rows })
      continue
    }

    // 普通段落：吃到空行或下一个块级标记
    const paragraph: string[] = []
    while (index < lines.length) {
      const current = lines[index]
      if (
        current.trim() === '' ||
        isHeading(current) !== null ||
        /^\s*```/.test(current) ||
        isHr(current) ||
        isQuote(current) ||
        isList(current) ||
        // 紧贴段落的表格也要断开，否则整张表会被吞进段落。
        (current.includes('|') &&
          index + 1 < lines.length &&
          isTableSeparator(lines[index + 1]))
      ) {
        break
      }
      paragraph.push(current)
      index += 1
    }
    blocks.push({ type: 'paragraph', lines: paragraph })
  }

  return blocks
}

function findClosing(text: string, marker: string, from: number): number {
  return text.indexOf(marker, from)
}

export function parseInlineTokens(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let index = 0
  let plain = ''

  const flush = (): void => {
    if (plain !== '') {
      tokens.push({ type: 'text', value: plain })
      plain = ''
    }
  }

  while (index < text.length) {
    const rest = text.slice(index)

    // 行内代码优先，避免 code 里的 ** 被当粗体。
    if (rest.startsWith('`')) {
      const end = findClosing(text, '`', index + 1)
      if (end > index) {
        flush()
        tokens.push({ type: 'code', value: text.slice(index + 1, end) })
        index = end + 1
        continue
      }
    }

    if (rest.startsWith('**')) {
      const end = findClosing(text, '**', index + 2)
      if (end > index + 1) {
        flush()
        tokens.push({
          type: 'strong',
          children: parseInlineTokens(text.slice(index + 2, end))
        })
        index = end + 2
        continue
      }
    }

    if (rest.startsWith('~~')) {
      const end = findClosing(text, '~~', index + 2)
      if (end > index + 1) {
        flush()
        tokens.push({
          type: 'strike',
          children: parseInlineTokens(text.slice(index + 2, end))
        })
        index = end + 2
        continue
      }
    }

    if (rest.startsWith('*')) {
      const end = findClosing(text, '*', index + 1)
      if (end > index) {
        flush()
        tokens.push({
          type: 'em',
          children: parseInlineTokens(text.slice(index + 1, end))
        })
        index = end + 1
        continue
      }
    }

    if (rest.startsWith('[')) {
      const labelEnd = rest.indexOf('](')
      const hrefEnd = labelEnd >= 0 ? rest.indexOf(')', labelEnd) : -1
      if (labelEnd > 0 && hrefEnd > labelEnd) {
        const label = rest.slice(1, labelEnd)
        const href = rest.slice(labelEnd + 2, hrefEnd)
        flush()
        if (SAFE_HREF.test(href)) {
          tokens.push({ type: 'link', label, href })
        } else {
          // 不安全协议（javascript:/file:/data:）降级为纯文本。
          tokens.push({ type: 'text', value: `[${label}](${href})` })
        }
        index += hrefEnd + 1
        continue
      }
    }

    plain += text[index]
    index += 1
  }

  flush()
  return tokens
}
