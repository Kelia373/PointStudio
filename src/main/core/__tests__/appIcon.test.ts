// 契约测试：应用图标路径解析 + 已落盘资产的 ICO 结构。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { resolveAppIconPath } from '../appIcon.ts'
import {
  PNG_SIGNATURE,
  packPngsToIco,
  readIcoDirectory
} from '../../../../scripts/ico-pack.mjs'

const APP_PATH = join('C:', 'repo')
const RESOURCES = join('C:', 'app', 'resources')

function existsIn(paths: string[]): (value: string) => boolean {
  return (value) => paths.includes(value)
}

test('win32 优先 .ico，缺失时回退 .png', () => {
  const ico = join(APP_PATH, 'src', 'main', 'assets', 'brand', 'icon.ico')
  const png = join(APP_PATH, 'src', 'main', 'assets', 'brand', 'icon.png')
  assert.equal(
    resolveAppIconPath({ platform: 'win32', appPath: APP_PATH, exists: existsIn([ico, png]) }),
    ico
  )
  assert.equal(
    resolveAppIconPath({ platform: 'win32', appPath: APP_PATH, exists: existsIn([png]) }),
    png
  )
})

test('darwin / linux 用 .png', () => {
  const png = join(APP_PATH, 'src', 'main', 'assets', 'brand', 'icon.png')
  assert.equal(
    resolveAppIconPath({ platform: 'darwin', appPath: APP_PATH, exists: existsIn([png]) }),
    png
  )
  assert.equal(
    resolveAppIconPath({ platform: 'linux', appPath: APP_PATH, exists: existsIn([png]) }),
    png
  )
})

test('打包态优先 resourcesPath/brand，再兜底 appPath', () => {
  const packaged = join(RESOURCES, 'brand', 'icon.ico')
  const source = join(APP_PATH, 'src', 'main', 'assets', 'brand', 'icon.ico')
  assert.equal(
    resolveAppIconPath({
      platform: 'win32',
      appPath: APP_PATH,
      resourcesPath: RESOURCES,
      isPackaged: true,
      exists: existsIn([packaged, source])
    }),
    packaged
  )
  assert.equal(
    resolveAppIconPath({
      platform: 'win32',
      appPath: APP_PATH,
      resourcesPath: RESOURCES,
      isPackaged: true,
      exists: existsIn([source])
    }),
    source
  )
})

test('全缺失返回 null，不抛错', () => {
  assert.equal(
    resolveAppIconPath({ platform: 'win32', appPath: APP_PATH, exists: () => false }),
    null
  )
})

test('packPngsToIco：目录 7 帧、256 编码为 0、每帧都是 PNG', () => {
  const frames = [16, 24, 32, 48, 64, 128, 256].map((size) => ({
    size,
    png: Buffer.concat([PNG_SIGNATURE, Buffer.alloc(32, size % 251)])
  }))
  const ico = packPngsToIco(frames)
  assert.equal(ico.subarray(0, 6).toString('hex'), '000001000700')
  const entries = readIcoDirectory(ico)
  assert.deepEqual(
    entries.map((entry) => entry.size),
    [16, 24, 32, 48, 64, 128, 256]
  )
  for (const entry of entries) {
    assert.deepEqual(ico.subarray(entry.offset, entry.offset + 8), PNG_SIGNATURE)
    assert.equal(ico.readUInt32LE(entry.offset), 0x474e5089)
  }
})

test('packPngsToIco：拒绝非 PNG 帧与非法尺寸', () => {
  assert.throws(
    () => packPngsToIco([{ size: 16, png: Buffer.from('not-a-png') }]),
    /不是 PNG/
  )
  assert.throws(() => packPngsToIco([{ size: 300, png: PNG_SIGNATURE }]), /非法尺寸/)
  assert.throws(() => packPngsToIco([]), /不能为空/)
})

test('已落盘资产：icon.ico 七档 PNG、icon.png 512 RGBA', () => {
  const brand = join(process.cwd(), 'src', 'main', 'assets', 'brand')
  const ico = readFileSync(join(brand, 'icon.ico'))
  assert.equal(ico.subarray(0, 6).toString('hex'), '000001000700')
  const entries = readIcoDirectory(ico)
  assert.deepEqual(
    entries.map((entry) => entry.size),
    [16, 24, 32, 48, 64, 128, 256]
  )
  for (const entry of entries) {
    assert.deepEqual(ico.subarray(entry.offset, entry.offset + 8), PNG_SIGNATURE)
  }

  const png = readFileSync(join(brand, 'icon.png'))
  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE)
  // IHDR: width/height at bytes 16..24，color type 6 = RGBA。
  assert.equal(png.readUInt32BE(16), 512)
  assert.equal(png.readUInt32BE(20), 512)
  assert.equal(png.readUInt8(25), 6)
})
