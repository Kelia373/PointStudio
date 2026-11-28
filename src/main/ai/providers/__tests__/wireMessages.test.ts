// 契约测试：三线多模态序列化 + 无图字节级不变。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  toAnthropicMessages,
  toOllamaMessages,
  toOpenAiMessages
} from '../wireMessages.ts'
import type { ChatMessageInput } from '../types.ts'

const IMAGE = { mimeType: 'image/png' as const, base64: 'QUJD' }

const PLAIN: ChatMessageInput[] = [
  { role: 'system', content: '你是助手' },
  { role: 'user', content: '你好' },
  { role: 'assistant', content: '在' }
]

test('无图消息：三线都保持 { role, content } 原样', () => {
  assert.deepEqual(toOpenAiMessages(PLAIN), PLAIN)
  assert.deepEqual(toAnthropicMessages(PLAIN), PLAIN)
  assert.deepEqual(toOllamaMessages(PLAIN), PLAIN)

  // 字节级也要一致：key 顺序、没有多余字段
  assert.equal(JSON.stringify(toOpenAiMessages(PLAIN)), JSON.stringify(PLAIN))
})

test('OpenAI：有图转 content 数组，文字在前、image_url 带 data URL', () => {
  const [message] = toOpenAiMessages([{ role: 'user', content: '看图', images: [IMAGE] }])
  assert.ok(Array.isArray(message.content))
  const parts = message.content as unknown as Array<Record<string, unknown>>
  assert.deepEqual(parts[0], { type: 'text', text: '看图' })
  assert.deepEqual(parts[1], {
    type: 'image_url',
    image_url: { url: 'data:image/png;base64,QUJD' }
  })
})

test('OpenAI：纯图（没有文字）只留图片段，不塞空 text', () => {
  const [message] = toOpenAiMessages([{ role: 'user', content: '   ', images: [IMAGE] }])
  const parts = message.content as unknown as Array<Record<string, unknown>>
  assert.equal(parts.length, 1)
  assert.equal(parts[0].type, 'image_url')
})

test('Anthropic：图片在前、文字在后，source 是 base64 三段', () => {
  const [message] = toAnthropicMessages([{ role: 'user', content: '看图', images: [IMAGE] }])
  const parts = message.content as unknown as Array<Record<string, unknown>>
  assert.deepEqual(parts[0], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/png', data: 'QUJD' }
  })
  assert.deepEqual(parts[1], { type: 'text', text: '看图' })
})

test('Ollama：消息对象带 images 纯 base64（不带 data: 前缀）', () => {
  const [message] = toOllamaMessages([{ role: 'user', content: '看图', images: [IMAGE] }])
  assert.deepEqual(message, { role: 'user', content: '看图', images: ['QUJD'] })
})

test('多图顺序稳定：按传入顺序排列，不重排', () => {
  const two = [IMAGE, { mimeType: 'image/webp' as const, base64: 'WFla' }]
  const [openai] = toOpenAiMessages([{ role: 'user', content: '', images: two }])
  const urls = (openai.content as unknown as Array<{ image_url?: { url: string } }>).map(
    (part) => part.image_url?.url
  )
  assert.deepEqual(urls, ['data:image/png;base64,QUJD', 'data:image/webp;base64,WFla'])

  const [ollama] = toOllamaMessages([{ role: 'user', content: '', images: two }])
  assert.deepEqual(ollama.images, ['QUJD', 'WFla'])
})
