// 契约测试：工具注册表（注册规则、参数校验、超时、错误归一、审计记录）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { ToolRegistry } from '../registry.ts'
import type { ToolDefinition, ToolRunRecord } from '../types.ts'

function makeTool(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name: 'echo',
    description: '回显输入',
    sideEffect: 'read-only',
    params: { text: { type: 'string', required: true } },
    async handler(input) {
      return { ok: true, value: (input as { text: string }).text }
    },
    ...overrides
  } as ToolDefinition
}

test('注册后可按名字取回，list 按名字排序', () => {
  const registry = new ToolRegistry()
  registry.register(makeTool({ name: 'zeta' }))
  registry.register(makeTool({ name: 'alpha' }))

  assert.equal(registry.get('alpha')?.name, 'alpha')
  assert.deepEqual(
    registry.list().map((tool) => tool.name),
    ['alpha', 'zeta']
  )
})

test('重名注册被拒绝，不覆盖已有工具', () => {
  const registry = new ToolRegistry()
  registry.register(makeTool({ name: 'dup', description: '第一个' }))

  assert.throws(() => registry.register(makeTool({ name: 'dup', description: '第二个' })), /E_TOOL_DUPLICATE/)
  assert.equal(registry.get('dup')?.description, '第一个')
})

test('非法名字被拒绝（只允许小写字母开头、字母数字下划线连字符）', () => {
  const registry = new ToolRegistry()
  for (const name of ['Bad Name', '1abc', '', '中文工具']) {
    assert.throws(() => registry.register(makeTool({ name })), /E_TOOL_BAD_NAME/, `应拒绝 ${name}`)
  }
})

test('副作用等级必须显式声明且合法', () => {
  const registry = new ToolRegistry()
  assert.throws(
    () => registry.register(makeTool({ name: 'bad-effect', sideEffect: 'whatever' as never })),
    /E_TOOL_BAD_SIDE_EFFECT/
  )
})

test('缺必填参数或类型不符时返回 E_TOOL_BAD_ARGS，且不调用 handler', async () => {
  const registry = new ToolRegistry()
  let called = false
  registry.register(
    makeTool({
      name: 'strict',
      async handler() {
        called = true
        return { ok: true, value: null }
      }
    })
  )

  const missing = await registry.run('strict', {})
  assert.deepEqual(missing, { ok: false, code: 'E_TOOL_BAD_ARGS' })

  const wrongType = await registry.run('strict', { text: 42 })
  assert.deepEqual(wrongType, { ok: false, code: 'E_TOOL_BAD_ARGS' })

  assert.equal(called, false, '参数不合法时不该碰 handler')
})

test('未知工具返回 E_TOOL_NOT_FOUND', async () => {
  const registry = new ToolRegistry()
  assert.deepEqual(await registry.run('nope', {}), { ok: false, code: 'E_TOOL_NOT_FOUND' })
})

test('handler 抛错归一为 E_TOOL_FAILED，不把异常漏给调用方', async () => {
  const registry = new ToolRegistry()
  registry.register(
    makeTool({
      name: 'boom',
      params: {},
      async handler() {
        throw new Error('内部细节不该外泄')
      }
    })
  )

  assert.deepEqual(await registry.run('boom', {}), { ok: false, code: 'E_TOOL_FAILED' })
})

test('超时返回 E_TOOL_TIMEOUT', async () => {
  const registry = new ToolRegistry()
  registry.register(
    makeTool({
      name: 'slow',
      params: {},
      timeoutMs: 30,
      async handler() {
        await new Promise((resolve) => setTimeout(resolve, 120))
        return { ok: true, value: 'late' }
      }
    })
  )

  assert.deepEqual(await registry.run('slow', {}), { ok: false, code: 'E_TOOL_TIMEOUT' })
})

test('成功调用返回结果，并留下审计记录', async () => {
  const registry = new ToolRegistry()
  const records: ToolRunRecord[] = []
  registry.register(makeTool({ name: 'audited' }))

  const result = await registry.run('audited', { text: 'hi' }, {
    onRecord: (record) => records.push(record)
  })

  assert.deepEqual(result, { ok: true, value: 'hi' })
  assert.equal(records.length, 1)
  assert.equal(records[0].toolName, 'audited')
  assert.equal(records[0].status, 'success')
  assert.ok(records[0].durationMs >= 0)
  assert.deepEqual(records[0].paramKeys, ['text'])
  assert.ok(!JSON.stringify(records[0]).includes('hi'), '审计记录不得包含参数值')
})

test('失败与超时也会记录审计', async () => {
  const registry = new ToolRegistry()
  const records: ToolRunRecord[] = []
  registry.register(
    makeTool({
      name: 'failing',
      params: {},
      async handler() {
        throw new Error('x')
      }
    })
  )

  await registry.run('failing', {}, { onRecord: (record) => records.push(record) })
  assert.equal(records[0].status, 'error')
})
