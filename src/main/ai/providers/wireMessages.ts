// providers/wireMessages —— 三套协议的消息序列化。
//
// 铁律：**无图消息必须字节级保持原样**（`{ role, content }`），否则所有历史
// 请求都会悄悄变成数组形式，各家的兼容分支、缓存命中率、计费口径全都变。
// 有图才升维，且每条线升成自己认识的形状：
//   OpenAI   → content: [{ type: 'text' }, { type: 'image_url' }]
//   Anthropic→ content: [{ type: 'image', source: base64 }, { type: 'text' }]
//   Ollama   → 消息对象带 `images: string[]`（纯 base64，不带 data: 前缀）
import type { ChatMessageInput } from './types.ts'

export interface OpenAiTextPart {
  type: 'text'
  text: string
}

export interface OpenAiImagePart {
  type: 'image_url'
  image_url: { url: string }
}

export type OpenAiMessage = {
  role: string
  content: string | Array<OpenAiTextPart | OpenAiImagePart>
}

export interface AnthropicTextPart {
  type: 'text'
  text: string
}

export interface AnthropicImagePart {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

export interface AnthropicMessage {
  role: string
  content: string | Array<AnthropicTextPart | AnthropicImagePart>
}

export interface OllamaMessage {
  role: string
  content: string
  images?: string[]
}

function hasImages(message: ChatMessageInput): boolean {
  return Array.isArray(message.images) && message.images.length > 0
}

export function toOpenAiMessages(messages: readonly ChatMessageInput[]): OpenAiMessage[] {
  return messages.map((message) => {
    if (!hasImages(message)) {
      return { role: message.role, content: message.content }
    }
    const text = message.content.trim()
    return {
      role: message.role,
      content: [
        ...(text === '' ? [] : [{ type: 'text' as const, text: message.content }]),
        ...(message.images ?? []).map((image) => ({
          type: 'image_url' as const,
          image_url: { url: `data:${image.mimeType};base64,${image.base64}` }
        }))
      ]
    }
  })
}

export function toAnthropicMessages(messages: readonly ChatMessageInput[]): AnthropicMessage[] {
  return messages.map((message) => {
    if (!hasImages(message)) {
      return { role: message.role, content: message.content }
    }
    const text = message.content.trim()
    return {
      role: message.role,
      // Anthropic 习惯图片在前、文字在后：先给图再给问题，指令落在最后。
      content: [
        ...(message.images ?? []).map((image) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: image.mimeType,
            data: image.base64
          }
        })),
        ...(text === '' ? [] : [{ type: 'text' as const, text: message.content }])
      ]
    }
  })
}

export function toOllamaMessages(messages: readonly ChatMessageInput[]): OllamaMessage[] {
  return messages.map((message) => {
    if (!hasImages(message)) {
      return { role: message.role, content: message.content }
    }
    return {
      role: message.role,
      content: message.content,
      images: (message.images ?? []).map((image) => image.base64)
    }
  })
}
