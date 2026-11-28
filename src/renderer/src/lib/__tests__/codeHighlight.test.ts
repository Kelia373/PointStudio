// 契约测试：零依赖代码词法着色。
//
// 最重要的一条不是「颜色对不对」，而是**拼接恒等**：
// tokens.map(t => t.value).join('') === 原文本，一个字符都不能少。
// 否则复制出来的代码会悄悄变形。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { tokenizeCode } from '../codeHighlight.ts'

const SAMPLES: Array<{ lang: string; code: string }> = [
  {
    lang: 'ts',
    code: `// 入口
import { readFile } from 'node:fs/promises'

export async function load(path: string): Promise<string> {
  const text = await readFile(path, 'utf8')
  const n = 0x1f + 42
  return \`len=\${text.length} n=\${n}\`
}`
  },
  {
    lang: 'js',
    code: `const re = /ab+c/g // 正则里也有斜杠
const s = 'he said "hi"' + "it's fine"
if (true && null === undefined) console.log(s.length > 3)`
  },
  {
    lang: 'python',
    code: `# 注释
def greet(name: str, age: int = 18) -> str:
    """docstring with 'quotes'"""
    total = 3.14 + 2
    return f"hi {name}, {age} {total}"

class Foo:
    pass`
  },
  {
    lang: 'json',
    code: `{"name": "PointStudio", "ok": true, "count": 12, "nested": {"x": null}}`
  },
  {
    lang: 'bash',
    code: `# build
set -euo pipefail
for f in src/*.ts; do
  echo "build $f" | tee log.txt
done
npm run build -- --flag=1`
  },
  {
    lang: 'go',
    code: `package main

func main() {
	fmt.Println("hi", 42)
}`
  },
  {
    lang: 'rust',
    code: `fn main() {
    let s = String::from("hi");
    println!("{}", s.len());
}`
  },
  {
    lang: 'css',
    code: `.a { color: #fff; margin: 0 auto; }`
  },
  {
    lang: 'sql',
    code: `SELECT id, name FROM users WHERE age >= 18 -- 成年
ORDER BY name;`
  },
  {
    lang: 'html',
    code: `<!-- 注释 -->
<div class="box">hello &amp; <span>world</span></div>`
  }
]

test('拼接恒等：任何语言、任何文本，token 拼回去必须逐字符等于原文', () => {
  for (const { lang, code } of SAMPLES) {
    const joined = tokenizeCode(code, lang)
      .map((token) => token.value)
      .join('')
    assert.equal(joined, code, `${lang} 拼接失真`)
  }
})

test('未知语言与 text：原样返回单块 plain', () => {
  const code = 'const a = 1\n<b>raw</b>'
  for (const lang of ['', 'text', 'plaintext', 'brainfuck']) {
    assert.deepEqual(tokenizeCode(code, lang), [{ kind: 'plain', value: code }])
  }
})

test('特殊字符原样保留：<script> 不被转义也不丢字符', () => {
  const code = '<script>alert("x")</script>'
  const tokens = tokenizeCode(code, 'text')
  assert.equal(tokens.map((token) => token.value).join(''), code)
})

test('TS 分词：关键字 / 字符串 / 数字 / 注释 / 函数调用各有其类', () => {
  const tokens = tokenizeCode(
    '// note\nconst n = 42\nawait readFile("a.txt")\n',
    'ts'
  )
  const kinds = new Set(tokens.map((token) => token.kind))
  assert.ok(kinds.has('comment'), '注释')
  assert.ok(kinds.has('kw'), '关键字')
  assert.ok(kinds.has('num'), '数字')
  assert.ok(kinds.has('str'), '字符串')
  assert.ok(kinds.has('fn'), '函数调用')

  const comment = tokens.find((token) => token.kind === 'comment')
  assert.equal(comment?.value, '// note')
  const str = tokens.find((token) => token.kind === 'str')
  assert.equal(str?.value, '"a.txt"')
})

test('布尔与 null 归入常量色（num）', () => {
  const tokens = tokenizeCode('const a = true\nconst b = null', 'ts')
  const nums = tokens.filter((token) => token.kind === 'num').map((token) => token.value)
  assert.deepEqual(nums, ['true', 'null'])
})

test('Python 的 # 注释与三引号字符串不吞上文', () => {
  const code = 'x = 1  # trailing\ns = """multi\nline"""\n'
  const tokens = tokenizeCode(code, 'python')
  assert.equal(tokens.map((token) => token.value).join(''), code)
  assert.equal(tokens.some((token) => token.kind === 'comment'), true)
})

test('未闭合的字符串不吞掉整个文件，仍保持拼接恒等', () => {
  const code = 'const s = "unterminated'
  const tokens = tokenizeCode(code, 'ts')
  assert.equal(tokens.map((token) => token.value).join(''), code)
})
