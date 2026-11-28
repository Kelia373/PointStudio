// scripts/ico-pack.mjs —— 纯 Node 的 PNG-in-ICO 打包与解析。
//
// 不依赖任何 npm 包：ICO 只是「目录 + 各帧 PNG 原样拼接」。
// 生成脚本与单测共用同一份实现，避免打包规则两处漂移。
import { Buffer } from 'node:buffer'

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * @param {Array<{ size: number; png: Buffer }>} frames
 * @returns {Buffer}
 */
export function packPngsToIco(frames) {
  if (!Array.isArray(frames) || frames.length === 0) {
    throw new Error('packPngsToIco: frames 不能为空')
  }
  if (frames.length > 255) {
    throw new Error('packPngsToIco: ICO 最多 255 帧')
  }
  const sorted = [...frames].sort((a, b) => a.size - b.size)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(sorted.length, 4)

  const directory = Buffer.alloc(16 * sorted.length)
  let offset = 6 + directory.length
  sorted.forEach((frame, index) => {
    if (!PNG_SIGNATURE.equals(frame.png.subarray(0, 8))) {
      throw new Error(`packPngsToIco: 第 ${index} 帧不是 PNG`)
    }
    if (frame.size < 1 || frame.size > 256) {
      throw new Error(`packPngsToIco: 非法尺寸 ${frame.size}`)
    }
    const base = index * 16
    // 256 在 ICO 目录里编码为 0。
    directory.writeUInt8(frame.size === 256 ? 0 : frame.size, base)
    directory.writeUInt8(frame.size === 256 ? 0 : frame.size, base + 1)
    directory.writeUInt8(0, base + 2) // color count
    directory.writeUInt8(0, base + 3) // reserved
    directory.writeUInt16LE(1, base + 4) // planes
    directory.writeUInt16LE(32, base + 6) // bit count
    directory.writeUInt32LE(frame.png.length, base + 8)
    directory.writeUInt32LE(offset, base + 12)
    offset += frame.png.length
  })

  return Buffer.concat([header, directory, ...sorted.map((frame) => frame.png)])
}

/**
 * 解析 ICO 目录：返回每帧尺寸与偏移，供单测/校验脚本使用。
 * @param {Buffer} buffer
 */
export function readIcoDirectory(buffer) {
  if (buffer.length < 6) {
    throw new Error('readIcoDirectory: 文件太短')
  }
  if (buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error('readIcoDirectory: 不是 ICO')
  }
  const count = buffer.readUInt16LE(4)
  const frames = []
  for (let index = 0; index < count; index++) {
    const base = 6 + index * 16
    const rawWidth = buffer.readUInt8(base)
    const rawHeight = buffer.readUInt8(base + 1)
    frames.push({
      size: rawWidth === 0 ? 256 : rawWidth,
      height: rawHeight === 0 ? 256 : rawHeight,
      bytes: buffer.readUInt32LE(base + 8),
      offset: buffer.readUInt32LE(base + 12)
    })
  }
  return frames
}
