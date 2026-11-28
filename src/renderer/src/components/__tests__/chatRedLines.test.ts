// 硬红线静态断言：只锁安全与结构，不锁排版（避免调样式就误伤）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(relative: string): string {
  return readFileSync(new URL(relative, import.meta.url), 'utf8')
}

const COMPONENTS = ['../ChatImages.tsx', '../MessageBubble.tsx', '../Composer.tsx', '../MarkdownBody.tsx']

test('渲染层零 dangerouslySetInnerHTML（模型输出永远走 React 节点）', () => {
  for (const file of COMPONENTS) {
    // 只查真实用法（`={...}` / `:`），注释里提到这个词不算
    assert.equal(
      /dangerouslySetInnerHTML\s*[={:]/.test(source(file)),
      false,
      `${file} 出现了危险注入`
    )
  }
})

test('用户提问分支不渲染头像', () => {
  const bubble = source('../MessageBubble.tsx')
  assert.equal(bubble.includes('msg__user-avatar'), false, '用户气泡不应有专属头像节点')
  const avatarUses = bubble.split('<AgentAvatar').length - 1
  assert.ok(avatarUses <= 1, 'AgentAvatar 只应出现一次（助手身份栏）')
})

test('灯箱必须有 Esc 与左右方向键，且点击遮罩可关闭', () => {
  const lightbox = source('../ChatImages.tsx')
  assert.ok(lightbox.includes("'Escape'"), '缺少 Escape 关闭')
  assert.ok(lightbox.includes("'ArrowLeft'"), '缺少左方向键')
  assert.ok(lightbox.includes("'ArrowRight'"), '缺少右方向键')
  assert.ok(lightbox.includes('lightbox__mask'), '缺少遮罩点击关闭')
})

test('三线序列化不得把无图消息改成数组（wireMessages 保形）', () => {
  const wire = source('../../../../main/ai/providers/wireMessages.ts')
  assert.ok(wire.includes('if (!hasImages(message))'), '必须有「无图原样返回」分支')
  assert.ok(wire.includes('role: message.role, content: message.content'), '无图分支要保形')
})

test('输入框不再出现 emoji 占位与独立胶囊行（行内胶囊用矢量图标）', () => {
  const composer = source('../Composer.tsx')
  assert.equal(composer.includes('\u{1F5BC}'), false, '不再用 emoji 当图片占位')
  assert.equal(composer.includes('composer__chips'), false, '中间那行独立胶囊应删除')
  assert.ok(composer.includes('composer__inline-chip'), '行内胶囊必须在')
  assert.ok(composer.includes('contentEditable'), '编辑区是 contentEditable')
  assert.ok(composer.includes('isComposingRef'), '必须保护中文输入法合成期')

  const imageIcon = readFileSync(
    new URL('../../assets/icons/image.svg', import.meta.url),
    'utf8'
  )
  assert.ok(imageIcon.includes('<rect'), 'image.svg 必须是相框矢量图标')
})
