// core/appIcon —— 运行期应用图标路径解析。
//
// 只做路径决策，不读文件、不碰 electron：exists 由组合根注入，便于单测。
// 目录约定：src/main/assets/brand/（源码态）/ resourcesPath/brand（打包态）。
import { join } from 'node:path'

export interface AppIconOptions {
  platform: NodeJS.Platform
  /** app.getAppPath()：开发态是仓库根，打包态是 app.asar。 */
  appPath: string
  /** process.resourcesPath：仅打包态有意义。 */
  resourcesPath?: string
  isPackaged?: boolean
  exists: (path: string) => boolean
}

const BRAND_DIR = ['src', 'main', 'assets', 'brand']

function candidates(options: AppIconOptions, name: string): string[] {
  const list: string[] = []
  if (options.isPackaged && options.resourcesPath) {
    list.push(join(options.resourcesPath, 'brand', name))
  }
  // 开发态（以及打包后仍保留源码结构时的兜底）。
  list.push(join(options.appPath, ...BRAND_DIR, name))
  if (options.isPackaged) {
    list.push(join(options.appPath, 'brand', name))
  }
  return list
}

/**
 * Windows 优先多分辨率 .ico（任务栏/标题栏都清晰），其余平台用 512 PNG。
 * 找不到时返回 null，由调用方退回 Electron 默认图标。
 */
export function resolveAppIconPath(options: AppIconOptions): string | null {
  const names = options.platform === 'win32' ? ['icon.ico', 'icon.png'] : ['icon.png']
  for (const name of names) {
    for (const path of candidates(options, name)) {
      if (options.exists(path)) {
        return path
      }
    }
  }
  return null
}
