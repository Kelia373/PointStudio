// 契约测试：会话导出的文件名。
//
// 导出是「点一下就落盘」，文件名直接决定用户能不能再找到它，
// 所以非法字符与空标题必须在纯函数里就处理干净。
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { exportFileName } from '../exportFile.ts'

test('正常标题：加前缀与 .md 后缀', () => {
  assert.equal(exportFileName('帮我改短这段话'), 'pointstudio-帮我改短这段话.md')
})

test('空标题与纯空白给占位名，不产出「.md」这种文件', () => {
  assert.equal(exportFileName(null), 'pointstudio-未命名会话.md')
  assert.equal(exportFileName('   '), 'pointstudio-未命名会话.md')
})

test('路径分隔符与 Windows 非法字符被替换，文件名不会裂成多级目录', () => {
  assert.equal(exportFileName('a/b:c*d?e'), 'pointstudio-a-b-c-d-e.md')
  assert.equal(exportFileName('../../etc/passwd'), 'pointstudio-..-..-etc-passwd.md')
})

test('超长标题截断，避免超出文件系统上限', () => {
  const name = exportFileName('长'.repeat(200))
  assert.equal(name.length, 'pointstudio-'.length + 40 + '.md'.length)
})
