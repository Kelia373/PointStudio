#!/usr/bin/env node
/**
 * 生成 docs/README.md（文档索引）。
 *
 * 单一所有者：本文件产出的就是 docs/README.md，禁止手改。
 * 改完文档跑 `pnpm docs:index`；CI 跑 `pnpm docs:index:check` 判定生成物是否漂移。
 *
 * 零依赖：本项目 docs 不用 YAML frontmatter，标题取首个 H1，说明取 H1 与首个 H2
 * 之间的第一段正文。若以后给文档加了 frontmatter.description，优先级高于正文。
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DOCS_DIR = path.join(ROOT, 'docs')
const OUTPUT = path.join(DOCS_DIR, 'README.md')
const SELF = path.basename(OUTPUT)

/** 分区定义：顺序即输出顺序。glob 为相对 docs/ 的目录或「顶层文件名前缀」。 */
const SECTIONS = [
  { title: '总纲', dir: null, topPrefixes: ['00-', '01-', '02-', '03-', '04-'] },
  { title: 'ADR', dir: 'adr' },
  { title: '设计笔记', dir: 'notes' },
  { title: '参考', dir: 'references' }
]

const IGNORED_DIRS = new Set(['node_modules', '.git', '.obsidian'])

/* ---------- 解析 ---------- */

/** 剥离 frontmatter，返回 { data, body }。仅支持顶层的 `key: value`。 */
const splitFrontmatter = (raw) => {
  if (!raw.startsWith('---')) return { data: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { data: {}, body: raw }
  const data = {}
  for (const line of raw.slice(4, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (m) data[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return { data, body: raw.slice(end + 4) }
}

/** 去掉围栏代码块，避免把代码里的 `# xxx` 当成标题。 */
const stripFences = (body) => body.replace(/^```[\s\S]*?^```/gm, '')

/** 文档 H1；无 H1 时退回文件名。 */
const docTitle = (filePath) => {
  const { data, body } = splitFrontmatter(fs.readFileSync(filePath, 'utf8'))
  if (typeof data.title === 'string' && data.title) return data.title
  const heading = stripFences(body).match(/^# (.+)$/m)
  return heading ? heading[1].trim() : path.basename(filePath, '.md')
}

const MAX_DESCRIPTION = 140

/** 该行是否属于「非正文」：空行、引用块、列表、表格、标题、水平线。 */
const isNonProse = (line) =>
  !line ||
  /^>/.test(line) ||
  /^[-*+]\s/.test(line) ||
  /^\d+[.)]\s/.test(line) ||
  /^\|/.test(line) ||
  /^#/.test(line) ||
  /^(-{3,}|\*{3,}|_{3,})$/.test(line)

/**
 * 从正文挑说明段。
 * 先看 H1 与首个 H2 之间；那里没有正文（例如开头直接进小节或只有元信息列表）时，
 * 退回全文第一个正文段落。
 */
const pickParagraph = (body, { stopAtH2 }) => {
  const lines = stripFences(body).split('\n')
  let started = false
  const paragraph = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!started) {
      if (/^# /.test(trimmed)) started = true
      continue
    }
    if (stopAtH2 ? /^## /.test(trimmed) : /^# /.test(trimmed)) break
    if (isNonProse(trimmed)) {
      if (paragraph.length) break
      continue
    }
    paragraph.push(trimmed)
  }
  return paragraph.join(' ')
}

/** 说明：frontmatter.description 优先，其次 H1 后正文，再次全文首个正文段。 */
const docDescription = (filePath) => {
  const { data, body } = splitFrontmatter(fs.readFileSync(filePath, 'utf8'))
  const raw =
    (typeof data.description === 'string' && data.description) ||
    pickParagraph(body, { stopAtH2: true }) ||
    pickParagraph(body, { stopAtH2: false })
  if (raw.length <= MAX_DESCRIPTION) return raw
  return raw.slice(0, MAX_DESCRIPTION).trimEnd() + '…'
}

/* ---------- 收集 ---------- */

const listMarkdown = (dir) => {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      out.push(...listMarkdown(full))
    } else if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== SELF) {
      out.push(full)
    }
  }
  return out
}

/** README 优先，其次层级浅优先，最后按中文文件名排序。 */
const orderDocs = (baseDir, files) => {
  const depth = (file) => file.split(path.sep).length
  return [...files].sort((a, b) => {
    const aTop = path.dirname(a) === baseDir && path.basename(a) === 'README.md' ? 0 : 1
    const bTop = path.dirname(b) === baseDir && path.basename(b) === 'README.md' ? 0 : 1
    return aTop - bTop || depth(a) - depth(b) || path.basename(a).localeCompare(path.basename(b), 'zh-Hans')
  })
}

/** 表格单元格转义：`|` 会切断行，换行会切断表格。 */
const escapeCell = (value) => (value || '').replaceAll('|', '\\|').replaceAll('\n', ' ').trim()

const toRows = (files) =>
  files.map((file) => {
    const link = './' + path.relative(DOCS_DIR, file).split(path.sep).join('/')
    return `| [${escapeCell(docTitle(file))}](${link}) | ${escapeCell(docDescription(file))} |`
  })

const collectSection = ({ dir, topPrefixes }) => {
  if (dir) return orderDocs(path.join(DOCS_DIR, dir), listMarkdown(path.join(DOCS_DIR, dir)))
  const top = fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md') && e.name !== SELF)
    .map((e) => e.name)
    .filter((name) => topPrefixes.some((prefix) => name.startsWith(prefix)))
    .map((name) => path.join(DOCS_DIR, name))
  return orderDocs(DOCS_DIR, top)
}

/* ---------- 生成 ---------- */

export const generateIndex = () => {
  const lines = [
    '# PointStudio 文档索引',
    '',
    '<!-- 由 scripts/gen-doc-index.mjs 生成，请勿手改；改完文档跑 `pnpm docs:index`。 -->',
    '',
    '规则性内容以根目录 `AGENTS.md` 为准，本页只是入口索引。'
  ]

  for (const section of SECTIONS) {
    const files = collectSection(section)
    if (!files.length) continue
    lines.push('', `## ${section.title}`, '', '| 文档 | 说明 |', '| --- | --- |', ...toRows(files))
  }

  return lines.join('\n') + '\n'
}

/** 事务式写入：要么都成，要么回滚，不留半更新的中间态。 */
const write = (content) => {
  const dir = fs.mkdtempSync(path.join(DOCS_DIR, '.doc-index-'))
  const staged = path.join(dir, 'new.md')
  const backup = path.join(dir, 'old.md')
  try {
    fs.writeFileSync(staged, content)
    const hadFile = fs.existsSync(OUTPUT) && fs.statSync(OUTPUT).isFile()
    if (hadFile) fs.copyFileSync(OUTPUT, backup)
    try {
      fs.renameSync(staged, OUTPUT)
    } catch (error) {
      if (hadFile) fs.copyFileSync(backup, OUTPUT)
      else fs.rmSync(OUTPUT, { force: true })
      throw error
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/* ---------- 入口 ---------- */

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const generated = generateIndex()
  if (process.argv.includes('--check')) {
    const current = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, 'utf8') : ''
    if (current !== generated) {
      console.error('docs/README.md 已过期 —— 跑 `pnpm docs:index` 并提交结果。')
      process.exit(1)
    }
    console.log('文档索引 OK。')
  } else {
    write(generated)
    console.log('已写入 docs/README.md')
  }
}
