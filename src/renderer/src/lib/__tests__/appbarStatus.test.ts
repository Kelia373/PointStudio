// 契约测试：底栏默认状态文案。
//
// 底栏此前只挂了两个空插槽，没有插件时就是一条空黑条。
// 这里把「左侧说引擎状态、右侧说会话数与版本」定成可测的纯函数。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { appbarLeft, appbarRight } from '../appbarStatus.ts'

test('左侧：有模型名时把状态和模型拼在一起', () => {
  assert.equal(appbarLeft({ mode: 'live', busy: false, model: 'deepseek-chat' }), '真模型 · deepseek-chat')
  assert.equal(appbarLeft({ mode: 'local', busy: false, model: 'llama3.1' }), '本地假流式 · llama3.1')
})

test('左侧：没配模型时只显示状态，不留悬空分隔符', () => {
  assert.equal(appbarLeft({ mode: 'live', busy: false, model: '' }), '真模型')
  assert.equal(appbarLeft({ mode: '', busy: false, model: '' }), '未发送')
})

test('左侧：正在生成时优先说生成中，而不是模型已就绪', () => {
  assert.equal(appbarLeft({ mode: 'live', busy: true, model: 'deepseek-chat' }), '生成中 · deepseek-chat')
})

test('右侧：会话数恒在，版本号可选', () => {
  assert.equal(appbarRight({ sessionCount: 0 }), '0 个会话')
  assert.equal(appbarRight({ sessionCount: 12 }), '12 个会话')
  assert.equal(appbarRight({ sessionCount: 3, version: 'Electron 33.0.0' }), '3 个会话 · Electron 33.0.0')
})

test('右侧：版本号为空串时等同于没有', () => {
  assert.equal(appbarRight({ sessionCount: 2, version: '' }), '2 个会话')
})
