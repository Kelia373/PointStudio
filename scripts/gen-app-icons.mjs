// scripts/gen-app-icons.mjs —— 手工生成桌面图标资产（不在 CI 里跑）。
//
// 用法：`node_modules/.bin/electron scripts/gen-app-icons.mjs`
// 依赖：仓内已有的 Electron（离屏窗口栅格化 SVG）+ 纯 Node ICO 打包（./ico-pack.mjs）。
// 产物：src/main/assets/brand/icon.png（512）与 icon.ico（7 档 PNG-in-ICO）。
//
// 说明：Windows 对 24px 以下窗口有最小尺寸限制，直接开小窗会失败；
// 这里固定开 512 窗口、把 SVG 按目标尺寸画在左上角，再用 capturePage 裁切。
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { packPngsToIco } from './ico-pack.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BRAND_DIR = join(ROOT, 'src', 'main', 'assets', 'brand')
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const PNG_SIZE = 512
const CANVAS_SIZE = 512

function renderHtml(svg, size) {
  const encoded = Buffer.from(svg, 'utf8').toString('base64')
  return `<html><body style="margin:0;background:transparent;overflow:hidden">
<img src="data:image/svg+xml;base64,${encoded}" width="${size}" height="${size}" style="display:block">
</body></html>`
}

async function capture(window, svg, size) {
  await window.loadURL(
    'data:text/html;charset=utf-8,' + encodeURIComponent(renderHtml(svg, size))
  )
  // 等一帧布局 + 绘制完成，避免 capturePage 抓到空白。
  await new Promise((resolve) => setTimeout(resolve, 120))
  const image = await window.capturePage({ x: 0, y: 0, width: size, height: size })
  return image.toPNG()
}

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

app
  .whenReady()
  .then(async () => {
    const svg = readFileSync(join(BRAND_DIR, 'icon.svg'), 'utf8')
    const window = new BrowserWindow({
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      webPreferences: { offscreen: true }
    })

    try {
      writeFileSync(join(BRAND_DIR, 'icon.png'), await capture(window, svg, PNG_SIZE))

      const frames = []
      for (const size of ICO_SIZES) {
        frames.push({ size, png: await capture(window, svg, size) })
      }
      writeFileSync(join(BRAND_DIR, 'icon.ico'), packPngsToIco(frames))
      console.log(
        `[icons] icon.png ${PNG_SIZE}px, icon.ico ${ICO_SIZES.join('/')} (${frames.length} frames)`
      )
    } finally {
      window.destroy()
    }
    app.quit()
  })
  .catch((error) => {
    console.error('[icons] 生成失败', error)
    app.quit()
    process.exitCode = 1
  })
