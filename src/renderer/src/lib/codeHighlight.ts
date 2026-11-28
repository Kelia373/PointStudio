// lib/codeHighlight —— 零依赖代码轻量词法着色。
//
// 为什么自己写：接 highlight.js / shiki 会引入几 MB 与一堆 CSS 主题，而聊天里
// 真正需要的只是「关键字、字符串、数字、注释、函数名」这几档颜色。
//
// 铁律：`tokens.map(t => t.value).join('') === 原文本`。
// 复制按钮、缩进、行尾空格全靠这条不变量；词法稍有闪失就会悄悄改代码。

export type CodeTokenKind = 'plain' | 'kw' | 'type' | 'str' | 'num' | 'fn' | 'comment'

export interface CodeToken {
  kind: CodeTokenKind
  value: string
}

type Family = 'js' | 'py' | 'json' | 'sh' | 'go' | 'rust' | 'css' | 'html' | 'sql'

interface FamilySpec {
  keywords: Set<string>
  types: Set<string>
  /** 布尔 / null / nil 这类常量，统一走「数字」色。 */
  constants: Set<string>
  line: string[]
  block?: [string, string]
  /** 长引号要排在短引号前面（""" 优先于 "）。 */
  quotes: string[]
  compareCaseInsensitive?: boolean
  /** HTML 标签名单独认。 */
  tags?: boolean
}

const JS_KEYWORDS = [
  'import', 'from', 'export', 'default', 'const', 'let', 'var', 'function', 'return',
  'async', 'await', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'new', 'class', 'extends', 'implements', 'interface', 'type', 'enum',
  'as', 'in', 'of', 'instanceof', 'typeof', 'void', 'delete', 'throw', 'try', 'catch',
  'finally', 'yield', 'static', 'public', 'private', 'protected', 'readonly', 'declare',
  'namespace', 'module', 'require', 'this', 'super', 'with', 'satisfies', 'keyof'
]

const JS_TYPES = [
  'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint',
  'String', 'Number', 'Boolean', 'Object', 'Array', 'Promise', 'Map', 'Set', 'Date',
  'Error', 'Record', 'Partial', 'Readonly', 'Pick', 'Omit', 'JSON'
]

const PY_KEYWORDS = [
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue',
  'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'yield', 'lambda',
  'global', 'nonlocal', 'assert', 'del', 'pass', 'in', 'is', 'not', 'and', 'or', 'async',
  'await', 'match', 'case'
]

const PY_TYPES = [
  'int', 'float', 'str', 'bool', 'bytes', 'list', 'dict', 'set', 'tuple', 'object',
  'Exception', 'NoneType', 'Any', 'Optional', 'List', 'Dict', 'Tuple'
]

const GO_KEYWORDS = [
  'package', 'import', 'func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case',
  'default', 'break', 'continue', 'var', 'const', 'type', 'struct', 'interface', 'map',
  'chan', 'go', 'defer', 'select', 'fallthrough', 'goto'
]

const GO_TYPES = [
  'string', 'int', 'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32',
  'uint64', 'float32', 'float64', 'bool', 'byte', 'rune', 'error', 'any'
]

const RUST_KEYWORDS = [
  'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'trait', 'impl', 'pub', 'use',
  'mod', 'crate', 'super', 'self', 'return', 'if', 'else', 'match', 'for', 'while',
  'loop', 'break', 'continue', 'async', 'await', 'move', 'ref', 'where', 'type', 'dyn',
  'unsafe', 'extern'
]

const RUST_TYPES = [
  'String', 'str', 'i8', 'i16', 'i32', 'i64', 'i128', 'u8', 'u16', 'u32', 'u64', 'u128',
  'f32', 'f64', 'bool', 'char', 'usize', 'isize', 'Vec', 'Option', 'Result', 'Box'
]

const SH_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until',
  'case', 'esac', 'function', 'return', 'exit', 'export', 'local', 'readonly', 'set',
  'unset', 'source', 'alias', 'echo', 'cd', 'sudo'
]

const SQL_KEYWORDS = [
  'select', 'from', 'where', 'insert', 'into', 'values', 'update', 'set', 'delete',
  'create', 'table', 'alter', 'drop', 'join', 'left', 'right', 'inner', 'outer', 'on',
  'group', 'by', 'order', 'having', 'limit', 'offset', 'distinct', 'as', 'and', 'or',
  'not', 'null', 'is', 'in', 'exists', 'union', 'all', 'index', 'primary', 'key',
  'foreign', 'references', 'begin', 'commit', 'rollback', 'with', 'case', 'when', 'then',
  'end'
]

function spec(partial: Partial<FamilySpec> & Pick<FamilySpec, 'keywords' | 'quotes'>): FamilySpec {
  return {
    types: new Set(),
    // 常量按**原样大小写**比对：Python 的 True/None 是大写，JS 的 true/null 是小写，
    // 混成一套小写集合就会把 `Class` / `Return` 这类普通标识符也染成常量色。
    constants: new Set(),
    line: [],
    ...partial
  }
}

const SPECS: Record<Family, FamilySpec> = {
  js: spec({
    keywords: new Set(JS_KEYWORDS),
    types: new Set(JS_TYPES),
    constants: new Set(['true', 'false', 'null', 'undefined']),
    line: ['//'],
    block: ['/*', '*/'],
    quotes: ['`', '"', "'"]
  }),
  py: spec({
    keywords: new Set(PY_KEYWORDS),
    types: new Set(PY_TYPES),
    constants: new Set(['True', 'False', 'None']),
    line: ['#'],
    quotes: ['"""', "'''", '"', "'"]
  }),
  json: spec({
    keywords: new Set(),
    constants: new Set(['true', 'false', 'null']),
    quotes: ['"']
  }),
  sh: spec({
    keywords: new Set(SH_KEYWORDS),
    line: ['#'],
    quotes: ['"', "'"]
  }),
  go: spec({
    keywords: new Set(GO_KEYWORDS),
    types: new Set(GO_TYPES),
    constants: new Set(['true', 'false', 'nil']),
    line: ['//'],
    block: ['/*', '*/'],
    quotes: ['`', '"', "'"]
  }),
  rust: spec({
    keywords: new Set(RUST_KEYWORDS),
    types: new Set(RUST_TYPES),
    constants: new Set(['true', 'false']),
    line: ['//'],
    block: ['/*', '*/'],
    quotes: ['"', "'"]
  }),
  css: spec({
    keywords: new Set(['important', 'media', 'supports', 'keyframes', 'from', 'to']),
    line: [],
    block: ['/*', '*/'],
    quotes: ['"', "'"]
  }),
  html: spec({
    keywords: new Set(),
    line: [],
    block: ['<!--', '-->'],
    quotes: ['"', "'"],
    tags: true
  }),
  sql: spec({
    keywords: new Set(SQL_KEYWORDS),
    constants: new Set(['true', 'false', 'null']),
    line: ['--'],
    block: ['/*', '*/'],
    quotes: ["'", '"'],
    compareCaseInsensitive: true
  })
}

const ALIASES: Record<string, Family> = {
  ts: 'js', tsx: 'js', js: 'js', jsx: 'js', mjs: 'js', cjs: 'js', typescript: 'js',
  javascript: 'js',
  py: 'py', python: 'py', python3: 'py',
  json: 'json', jsonc: 'json',
  sh: 'sh', bash: 'sh', zsh: 'sh', shell: 'sh', console: 'sh', powershell: 'sh', ps1: 'sh',
  go: 'go', golang: 'go',
  rust: 'rust', rs: 'rust',
  css: 'css', scss: 'css', less: 'css',
  html: 'html', xml: 'html', vue: 'html', svg: 'html',
  sql: 'sql', mysql: 'sql', postgres: 'sql', postgresql: 'sql', sqlite: 'sql'
}

const LABELS: Record<string, string> = {
  ts: 'TS',
  tsx: 'TS',
  typescript: 'TS',
  js: 'JS',
  jsx: 'JS',
  mjs: 'JS',
  cjs: 'JS',
  javascript: 'JS',
  py: 'PY',
  python: 'PY',
  python3: 'PY',
  json: 'JSON',
  jsonc: 'JSON',
  sh: 'SH',
  bash: 'SH',
  zsh: 'SH',
  shell: 'SH',
  console: 'SH',
  powershell: 'SH',
  ps1: 'SH',
  go: 'GO',
  golang: 'GO',
  rust: 'RS',
  rs: 'RS',
  css: 'CSS',
  scss: 'CSS',
  less: 'CSS',
  html: 'HTML',
  xml: 'HTML',
  vue: 'HTML',
  svg: 'HTML',
  sql: 'SQL',
  mysql: 'SQL',
  postgres: 'SQL',
  postgresql: 'SQL',
  sqlite: 'SQL'
}

/**
 * 代码块顶栏的小徽标：TS 与 JS 必须分开显示；未知语言原样显示用户写的名字
 * （显示成 `text` 会让人以为高亮失败），只有空语言才回退 `text`。
 */
export function codeLanguageLabel(lang: string): string {
  const key = lang.trim().toLowerCase()
  if (key === '') {
    return 'text'
  }
  return LABELS[key] ?? lang.trim()
}

/** 这个语言是否走着色（未知语言直接原样返回，也不显示彩色）。 */
export function isHighlightable(lang: string): boolean {
  return ALIASES[lang.trim().toLowerCase()] !== undefined
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$-]*/
const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)/
const TAG = /^<\/?[A-Za-z][A-Za-z0-9-]*/

export function tokenizeCode(code: string, lang: string): CodeToken[] {
  const family = ALIASES[lang.trim().toLowerCase()]
  if (family === undefined) {
    return code === '' ? [] : [{ kind: 'plain', value: code }]
  }
  const rules = SPECS[family]
  const tokens: CodeToken[] = []
  let plain = ''

  const flush = (): void => {
    if (plain !== '') {
      tokens.push({ kind: 'plain', value: plain })
      plain = ''
    }
  }
  const push = (kind: CodeTokenKind, value: string): void => {
    flush()
    tokens.push({ kind, value })
  }
  const isWordChar = (char: string | undefined): boolean =>
    char !== undefined && /[A-Za-z0-9_$]/.test(char)

  let i = 0
  while (i < code.length) {
    const rest = code.slice(i)

    if (rules.block !== undefined && rest.startsWith(rules.block[0])) {
      const [open, close] = rules.block
      const end = code.indexOf(close, i + open.length)
      const stop = end === -1 ? code.length : end + close.length
      push('comment', code.slice(i, stop))
      i = stop
      continue
    }

    const lineMark = rules.line.find((mark) => rest.startsWith(mark))
    if (lineMark !== undefined) {
      const end = code.indexOf('\n', i)
      const stop = end === -1 ? code.length : end
      push('comment', code.slice(i, stop))
      i = stop
      continue
    }

    if (rules.tags === true && rest[0] === '<' && TAG.test(rest)) {
      const matched = TAG.exec(rest)?.[0] ?? ''
      push('kw', matched)
      i += matched.length
      continue
    }

    const quote = rules.quotes.find((item) => rest.startsWith(item))
    if (quote !== undefined) {
      let j = i + quote.length
      while (j < code.length) {
        if (code[j] === '\\') {
          j += 2
          continue
        }
        if (code.startsWith(quote, j)) {
          j += quote.length
          break
        }
        // 单行字符串遇换行就停：不然一个未闭合引号会吞掉整个文件。
        if (quote.length === 1 && code[j] === '\n') {
          break
        }
        j += 1
      }
      const stop = Math.min(j, code.length)
      push('str', code.slice(i, stop))
      i = stop
      continue
    }

    if (code[i] >= '0' && code[i] <= '9' && !isWordChar(code[i - 1])) {
      const matched = NUMBER.exec(rest)?.[0]
      if (matched !== undefined) {
        push('num', matched)
        i += matched.length
        continue
      }
    }

    const ident = IDENT.exec(rest)?.[0]
    if (ident !== undefined) {
      const canon = rules.compareCaseInsensitive === true ? ident.toLowerCase() : ident
      if (rules.keywords.has(canon)) {
        push('kw', ident)
      } else if (rules.constants.has(canon)) {
        push('num', ident)
      } else if (rules.types.has(canon)) {
        push('type', ident)
      } else {
        let k = i + ident.length
        while (k < code.length && (code[k] === ' ' || code[k] === '\t')) {
          k += 1
        }
        if (code[k] === '(') {
          push('fn', ident)
        } else {
          plain += ident
        }
      }
      i += ident.length
      continue
    }

    plain += code[i]
    i += 1
  }

  flush()
  return tokens
}
