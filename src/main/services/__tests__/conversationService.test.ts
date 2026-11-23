// 契约测试：会话与消息的持久化与用例。
// 用真实临时目录，覆盖「关掉再打开」这类持久化真问题。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { JsonFileStore } from '../../data/fileStore.ts'
import { ConversationService } from '../conversationService.ts'
import type { Conversation, Message } from '../../ai/domain/conversation.ts'
import { DEFAULT_CONVERSATION_TITLE } from '../../ai/domain/conversation.ts'

interface Harness {
  service: ConversationService
  reopen: () => ConversationService
}

async function withService(run: (ctx: Harness) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'pointstudio-conv-'))
  let seq = 0
  let tick = 0
  const build = (): ConversationService => {
    // 每次 now() 递增，才能验证「按最近活动排序」。
    const now = (): string => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString()
    return new ConversationService(
      new JsonFileStore<Conversation>(join(dir, 'conversations.json')),
      new JsonFileStore<Message>(join(dir, 'messages.json')),
      { newId: () => `id-${++seq}`, now }
    )
  }
  try {
    await run({ service: build(), reopen: build })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('新建会话出现在列表，且标题可缺省', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({})
    assert.equal(created.ok, true)
    if (!created.ok) return

    assert.equal(created.value.title, DEFAULT_CONVERSATION_TITLE)
    const list = await service.list()
    assert.equal(list.length, 1)
  })
})

test('关掉再打开，会话与消息都还在', async () => {
  await withService(async ({ service, reopen }) => {
    const created = await service.create({})
    assert.equal(created.ok, true)
    if (!created.ok) return

    await service.appendMessage(created.value.id, { role: 'user', content: '你好' })
    await service.appendMessage(created.value.id, { role: 'assistant', content: '在' })

    const afterRestart = reopen()
    const conversations = await afterRestart.list()
    assert.equal(conversations.length, 1)
    const messages = await afterRestart.listMessages(created.value.id)
    assert.deepEqual(
      messages.map((m) => `${m.role}:${m.content}`),
      ['user:你好', 'assistant:在']
    )
  })
})

test('首条用户消息自动生成标题，之后不再覆盖', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({})
    if (!created.ok) return
    const id = created.value.id

    await service.appendMessage(id, { role: 'user', content: '帮我看看这个报错' })
    let conversations = await service.list()
    assert.equal(conversations[0].title, '帮我看看这个报错')

    await service.appendMessage(id, { role: 'user', content: '第二句话' })
    conversations = await service.list()
    assert.equal(conversations[0].title, '帮我看看这个报错', '标题只由首条消息决定')
  })
})

test('手工命名过的会话不被自动标题覆盖', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({ title: '我的会话' })
    if (!created.ok) return

    await service.appendMessage(created.value.id, { role: 'user', content: '随便说点什么' })
    const conversations = await service.list()
    assert.equal(conversations[0].title, '我的会话')
  })
})

test('新增消息会刷新最近活动时间，列表按它倒序', async () => {
  await withService(async ({ service }) => {
    const first = await service.create({ title: '早' })
    const second = await service.create({ title: '晚' })
    if (!first.ok || !second.ok) return

    await service.appendMessage(first.value.id, { role: 'user', content: '刚说话' })

    const list = await service.list()
    assert.equal(list[0].title, '早', '刚有活动的会话应排在最前')
  })
})

test('会话之间消息不串', async () => {
  await withService(async ({ service }) => {
    const a = await service.create({ title: 'A' })
    const b = await service.create({ title: 'B' })
    if (!a.ok || !b.ok) return

    await service.appendMessage(a.value.id, { role: 'user', content: 'A 的消息' })
    await service.appendMessage(b.value.id, { role: 'user', content: 'B 的消息' })

    assert.deepEqual(
      (await service.listMessages(a.value.id)).map((m) => m.content),
      ['A 的消息']
    )
    assert.deepEqual(
      (await service.listMessages(b.value.id)).map((m) => m.content),
      ['B 的消息']
    )
  })
})

test('向不存在的会话追加消息返回 E_NOT_FOUND', async () => {
  await withService(async ({ service }) => {
    const result = await service.appendMessage('missing', { role: 'user', content: 'x' })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_NOT_FOUND'))
    }
  })
})

test('空内容消息被拒绝', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({})
    if (!created.ok) return

    const result = await service.appendMessage(created.value.id, { role: 'user', content: '   ' })
    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.ok(result.errors.includes('E_EMPTY_CONTENT'))
    }
  })
})

test('删除会话会级联删除它的消息', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({})
    if (!created.ok) return
    const id = created.value.id
    await service.appendMessage(id, { role: 'user', content: '会被一起删掉' })

    assert.equal((await service.remove(id)).ok, true)
    assert.deepEqual(await service.list(), [])
    assert.deepEqual(await service.listMessages(id), [])
  })
})

test('编辑与删除单条消息', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({})
    if (!created.ok) return
    const added = await service.appendMessage(created.value.id, {
      role: 'user',
      content: '原内容'
    })
    if (!added.ok) return

    const edited = await service.updateMessage(added.value.id, '改过的内容')
    assert.equal(edited.ok, true)
    const messages = await service.listMessages(created.value.id)
    assert.equal(messages[0].content, '改过的内容')

    assert.equal((await service.removeMessage(added.value.id)).ok, true)
    assert.deepEqual(await service.listMessages(created.value.id), [])
  })
})

test('改名与会话不存在时的错误码', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({ title: '旧名' })
    if (!created.ok) return

    const renamed = await service.rename(created.value.id, '新名')
    assert.equal(renamed.ok, true)
    assert.equal((await service.list())[0].title, '新名')

    const missing = await service.rename('missing', '随便')
    assert.equal(missing.ok, false)
    if (!missing.ok) {
      assert.ok(missing.errors.includes('E_NOT_FOUND'))
    }
  })
})

test('get 能按 id 取回会话，不存在时返回 null', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({ title: '要取的' })
    if (!created.ok) return

    const found = await service.get(created.value.id)
    assert.equal(found?.title, '要取的')
    assert.equal(await service.get('missing'), null)
  })
})

test('绑定与解绑助手', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({ title: '绑助手' })
    if (!created.ok) return
    const id = created.value.id

    const bound = await service.setAssistant(id, 'assistant-1')
    assert.equal(bound.ok, true)
    assert.equal((await service.get(id))?.assistantId, 'assistant-1')

    const unbound = await service.setAssistant(id, null)
    assert.equal(unbound.ok, true)
    assert.equal((await service.get(id))?.assistantId, null)

    const missing = await service.setAssistant('missing', 'x')
    assert.equal(missing.ok, false)
  })
})

test('消息可以携带引用来源，并能读回', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({})
    if (!created.ok) return

    const added = await service.appendMessage(created.value.id, {
      role: 'assistant',
      content: '根据资料……',
      references: [{ chunkId: 'notes/a.md#0', source: 'notes/a.md' }]
    })
    assert.equal(added.ok, true)

    const messages = await service.listMessages(created.value.id)
    assert.deepEqual(messages[0].references, [{ chunkId: 'notes/a.md#0', source: 'notes/a.md' }])
  })
})

test('没有引用来源的消息保持 undefined，旧数据依然可读', async () => {
  await withService(async ({ service }) => {
    const created = await service.create({})
    if (!created.ok) return
    await service.appendMessage(created.value.id, { role: 'user', content: '普通消息' })

    const messages = await service.listMessages(created.value.id)
    assert.equal(messages[0].references, undefined)
  })
})
