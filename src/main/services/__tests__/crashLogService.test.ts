// 契约测试：崩溃报告落盘与轮转（文件名、脱敏、上限）。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { recordCrash, type CrashLogPorts } from '../crashLogService.ts'

const ENV = {
  appVersion: '0.0.0',
  platform: 'win32',
  arch: 'x64',
  electronVersion: '45.0.0'
}

interface Harness {
  ports: CrashLogPorts
  files: Map<string, string>
}

function makePorts(existing: string[] = [], options: { failWrite?: boolean } = {}): Harness {
  const files = new Map<string, string>(existing.map((name) => [name, '{}']))
  const ports: CrashLogPorts = {
    now: () => '2026-01-01T00:00:00.000Z',
    env: ENV,
    writeFile: async (name, content) => {
      if (options.failWrite) {
        throw new Error('EIO')
      }
      files.set(name, content)
    },
    listFiles: async () => [...files.keys()].filter((name) => name.startsWith('crash-')).sort(),
    removeFile: async (name) => {
      files.delete(name)
    }
  }
  return { ports, files }
}

test('生成带时间戳的文件名，内容是可解析的 JSON', async () => {
  const { ports, files } = makePorts()
  const result = await recordCrash(new Error('boom'), {}, ports)

  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.value.file, 'crash-2026-01-01T00-00-00-000Z.json')
  }
  const content = files.get('crash-2026-01-01T00-00-00-000Z.json')
  assert.ok(content)
  const parsed = JSON.parse(content) as { version: number; error: { message: string } }
  assert.equal(parsed.version, 1)
  assert.equal(parsed.error.message, 'boom')
})

test('落盘前脱敏：context 里的凭据不会进文件', async () => {
  const { ports, files } = makePorts()
  await recordCrash(new Error('boom'), { apiKey: 'sk-abcdefgh12345678' }, ports)

  const content = [...files.values()].join('')
  assert.ok(!content.includes('sk-abcdefgh12345678'))
})

test('超过保留上限时删除最旧的报告', async () => {
  const existing = [
    'crash-2025-12-29T00-00-00-000Z.json',
    'crash-2025-12-30T00-00-00-000Z.json',
    'crash-2025-12-31T00-00-00-000Z.json'
  ]
  const { ports, files } = makePorts(existing)
  const result = await recordCrash(new Error('boom'), {}, ports, { maxReports: 3 })

  assert.equal(result.ok, true)
  assert.equal(files.size, 3, '写完之后总数应等于上限')
  assert.ok(!files.has('crash-2025-12-29T00-00-00-000Z.json'), '最旧的应被删除')
  assert.ok(files.has('crash-2026-01-01T00-00-00-000Z.json'), '最新的应保留')
})

test('写失败时返回错误码，不抛给调用方', async () => {
  const { ports } = makePorts([], { failWrite: true })
  const result = await recordCrash(new Error('boom'), {}, ports)

  assert.equal(result.ok, false)
  if (!result.ok) {
    assert.ok(result.errors.includes('E_CRASH_LOG_WRITE_FAILED'))
  }
})

test('清理失败不影响报告本身（记录已写成）', async () => {
  const { ports, files } = makePorts(['crash-2020-01-01T00-00-00-000Z.json'])
  ports.removeFile = async () => {
    throw new Error('EIO')
  }

  const result = await recordCrash(new Error('boom'), {}, ports, { maxReports: 1 })
  assert.equal(result.ok, true)
  assert.equal(files.size, 2, '清理失败时旧文件留着，但新报告仍写成')
})
