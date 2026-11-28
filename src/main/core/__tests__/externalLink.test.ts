// 契约测试：外链安全判定。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isInternalNavigation, isSafeExternalUrl } from '../externalLink.ts'

test('只放行 http / https / mailto', () => {
  assert.equal(isSafeExternalUrl('https://example.com/a'), true)
  assert.equal(isSafeExternalUrl('http://example.com'), true)
  assert.equal(isSafeExternalUrl('mailto:hi@example.com'), true)
})

test('同源判断：http(s) 看 origin，file 只看同 pathname', () => {
  assert.equal(
    isInternalNavigation('https://app.local/chat', 'https://app.local/settings'),
    true
  )
  assert.equal(
    isInternalNavigation('https://app.local/chat', 'https://evil.local/chat'),
    false
  )
  assert.equal(
    isInternalNavigation('file:///C:/app/index.html', 'file:///C:/app/index.html'),
    true
  )
  // file:// 的 origin 都是 'null'，不能把别的本地文件当同源
  assert.equal(
    isInternalNavigation('file:///C:/app/index.html', 'file:///C:/Windows/win.ini'),
    false
  )
  assert.equal(isInternalNavigation('', 'https://x.dev'), false)
  assert.equal(isInternalNavigation('https://x.dev', 'not a url'), false)
})

test('危险协议与畸形输入一律拒绝', () => {
  assert.equal(isSafeExternalUrl('javascript:alert(1)'), false)
  assert.equal(isSafeExternalUrl('file:///C:/Windows'), false)
  assert.equal(isSafeExternalUrl('data:text/html,<script>'), false)
  assert.equal(isSafeExternalUrl('about:blank'), false)
  assert.equal(isSafeExternalUrl(''), false)
  assert.equal(isSafeExternalUrl('not a url'), false)
  assert.equal(isSafeExternalUrl(undefined as unknown as string), false)
})
