// 契约测试：内置工具（时间、计算、读文本文件）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createBuiltinTools } from '../index.ts'

const CLOCK = (): Date => new Date('2026-01-01T08:00:00.000Z')

function find(name: string, overrides: Parameters<typeof createBuiltinTools>[0] = {}) {
  const tools = createBuiltinTools({ clock: CLOCK, ...overrides })
  const tool = tools.find((item) => item.name === name)
  assert.ok(tool, `没找到工具 ${name}`)
  return tool
}

test('三个内置工具都声明了副作用等级，且都是只读', () => {
  const tools = createBuiltinTools({ clock: CLOCK })
  assert.deepEqual(
    tools.map((tool) => tool.name).sort(),
    ['calc', 'now', 'read_text_file']
  )
  assert.ok(tools.every((tool) => tool.sideEffect === 'read-only'))
})

test('now 使用注入的时钟，测试可确定性', async () => {
  const result = await find('now').handler({}, {})
  assert.deepEqual(result, { ok: true, value: { iso: '2026-01-01T08:00:00.000Z' } })
})

test('calc 支持优先级、括号、小数与一元负号', async () => {
  const calc = find('calc')
  const cases: Array<[string, number]> = [
    ['1+2*3', 7],
    ['(1+2)*3', 9],
    ['10/4', 2.5],
    [' 2 - -3 ', 5],
    ['-(2+3)', -5],
    ['1.5*2', 3]
  ]
  for (const [expression, expected] of cases) {
    const result = await calc.handler({ expression }, {})
    assert.equal(result.ok, true, `${expression} 应可计算`)
    if (result.ok) {
      assert.equal((result.value as { result: number }).result, expected, expression)
    }
  }
})

test('calc 拒绝无法解析的表达式与除以零，且不用 eval', async () => {
  const calc = find('calc')
  for (const expression of ['1/0', 'abc', '1+', '(1+2', 'alert(1)', '2**3']) {
    const result = await calc.handler({ expression }, {})
    assert.equal(result.ok, false, `应拒绝 ${expression}`)
  }
})

test('read_text_file 通过注入的读取器读文件', async () => {
  const read = async (path: string): Promise<string> => `内容:${path}`
  const result = await find('read_text_file', { readTextFile: read }).handler(
    { path: 'notes/a.md' },
    {}
  )

  assert.deepEqual(result, { ok: true, value: { path: 'notes/a.md', content: '内容:notes/a.md' } })
})

test('read_text_file 拒绝路径穿越与绝对路径，且不调用读取器', async () => {
  let called = false
  const read = async (): Promise<string> => {
    called = true
    return '不该被读到'
  }
  const tool = find('read_text_file', { readTextFile: read })

  for (const path of ['../secret.txt', 'a/../../etc/passwd', '/etc/passwd', 'C:\\Windows\\win.ini']) {
    const result = await tool.handler({ path }, {})
    assert.equal(result.ok, false, `应拒绝 ${path}`)
  }
  assert.equal(called, false, '路径不合法时不该发生任何读取')
})

test('read_text_file 对超长内容拒绝而不是静默截断', async () => {
  const read = async (): Promise<string> => 'x'.repeat(50)
  const result = await find('read_text_file', { readTextFile: read, maxBytes: 10 }).handler(
    { path: 'a.md' },
    {}
  )

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.equal(result.code, 'E_TOOL_FAILED')
  }
})
