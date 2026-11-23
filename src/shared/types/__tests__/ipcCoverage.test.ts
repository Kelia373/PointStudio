// 契约测试：IPC 通道一致性（声明 → 主进程处理器 → preload 暴露）。
//
// 为什么要有这条：通道漏接的典型症状是「点了没反应」，而 tsc、构建、
// 其余单测全都发现不了——因为字符串是合法的，只是没人监听。
// 这里用静态扫描兜住这类静默缺口。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const ROOT = process.cwd()

async function readSource(path: string): Promise<string> {
  return readFile(join(ROOT, path), 'utf8')
}

/** 从 `XXX_CHANNELS = { a: 'x:y', ... }` 里取出常量名。 */
function extractChannels(source: string): Map<string, string[]> {
  const result = new Map<string, string[]>()
  const blockPattern = /([A-Z_]+_CHANNELS)\s*=\s*\{([\s\S]*?)\}\s*as const/g

  for (const match of source.matchAll(blockPattern)) {
    const owner = match[1]
    const keys = [...match[2].matchAll(/([a-zA-Z0-9_]+)\s*:\s*'[^']+'/g)].map((item) => item[1])
    result.set(owner, keys)
  }
  return result
}

async function mainIpcSources(): Promise<string> {
  const dir = join(ROOT, 'src/main/ipc')
  const files = (await readdir(dir)).filter((name) => name.endsWith('.ts'))
  const parts = await Promise.all(files.map((name) => readSource(join('src/main/ipc', name))))
  return parts.join('\n')
}

test('每个平台的通道常量都声明了一个以上通道', async () => {
  const shared = await readSource('src/shared/types/ipc.ts')
  const channels = extractChannels(shared)

  assert.ok(channels.size >= 5, `通道常量太少，可能解析失效：${channels.size}`)
  for (const [owner, keys] of channels) {
    assert.ok(keys.length > 0, `${owner} 没有任何通道`)
  }
})

test('每个通道在主进程都有处理器或发送点', async () => {
  const shared = await readSource('src/shared/types/ipc.ts')
  const main = await mainIpcSources()
  const channels = extractChannels(shared)
  const missing: string[] = []

  for (const [owner, keys] of channels) {
    for (const key of keys) {
      const reference = `${owner}.${key}`
      // 主进程要么 handle（invoke 型），要么 on/send（事件型）。
      const used =
        main.includes(`handle(${reference}`) ||
        main.includes(`handle(\n    ${reference}`) ||
        main.includes(`on(${reference}`) ||
        main.includes(`send(${reference}`)
      if (!used) {
        missing.push(reference)
      }
    }
  }

  assert.deepEqual(missing, [], `以下通道在主进程没有对应处理：${missing.join(', ')}`)
})

test('每个通道在 preload 里都被用到（否则渲染进程够不着）', async () => {
  const shared = await readSource('src/shared/types/ipc.ts')
  const preload = await readSource('src/preload/index.ts')
  const channels = extractChannels(shared)
  const missing: string[] = []

  for (const [owner, keys] of channels) {
    for (const key of keys) {
      if (!preload.includes(`${owner}.${key}`)) {
        missing.push(`${owner}.${key}`)
      }
    }
  }

  assert.deepEqual(missing, [], `以下通道未在 preload 暴露：${missing.join(', ')}`)
})
