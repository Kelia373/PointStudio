// 契约测试：外链安全判定。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { isSafeExternalUrl } from '../externalLink.ts'

test('只放行 http / https / mailto', () => {
  assert.equal(isSafeExternalUrl('https://example.com/a'), true)
  assert.equal(isSafeExternalUrl('http://example.com'), true)
  assert.equal(isSafeExternalUrl('mailto:hi@example.com'), true)
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
