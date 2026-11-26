// lib/appbarStatus —— 底栏默认状态项。
//
// 底栏是两个追加型插槽（appbar.left / appbar.right）。没有插件时它此前是
// 一条没有任何文字的黑条，看起来像布局塌了。这里给出不依赖插件的默认内容：
// 左边说引擎在用什么状态跑，右边说有多少会话、什么版本。

export interface AppbarLeftInput {
  /** 'live' 真模型 / 'local' 本地假流式 / 其它视为未发送。 */
  mode: string
  busy: boolean
  model: string
}

export function appbarLeft(input: AppbarLeftInput): string {
  const state = input.busy
    ? '生成中'
    : input.mode === 'live'
      ? '真模型'
      : input.mode === 'local'
        ? '本地假流式'
        : '未发送'
  const model = input.model.trim()
  return model === '' ? state : `${state} · ${model}`
}

export interface AppbarRightInput {
  sessionCount: number
  /** 版本号（Electron 版本）；没有就只显示会话数。 */
  version?: string | null
}

export function appbarRight(input: AppbarRightInput): string {
  const count = `${input.sessionCount} 个会话`
  const version = (input.version ?? '').trim()
  return version === '' ? count : `${count} · ${version}`
}
