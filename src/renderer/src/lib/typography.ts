// lib/typography —— 全局字体 / 代码字体的注册表、持久化与应用（纯函数为主）。
//
// 字体全部随包内置（styles/fonts.css 的 @font-face），运行时不访问 CDN；
// 只有系统字体选项依赖本机已安装字体。新增字体时：assets/fonts 放 woff2、
// fonts.css 补 @font-face、本文件 UI_FONTS / CODE_FONTS 加一条，
// 三处 id 保持一致，其余界面不用改。

export type FontCategory = 'ui' | 'code'

export interface FontFamilyOption {
  /** 持久化用的稳定 id，改了会让用户选中项回落到默认值。 */
  id: string
  /** 下拉里显示的名字，用英文原名，和设计稿、字体源站一一对应。 */
  label: string
  category: FontCategory
  /** 完整 CSS font-family 值，已含中文回退链。 */
  css: string
  /** true = 随包内置 woff2，离线可用；false = 用本机系统字体。 */
  bundled: boolean
  /** 许可证，只收 SIL OFL-1.1 与系统字体，不收商业字体。 */
  license: string
  /** 一句话气质，给下拉里做副标题。 */
  note: string
}

export interface TypographyState {
  ui: string
  code: string
}

export const TYPOGRAPHY_STORAGE_KEY = 'pointstudio.typography'
export const DEFAULT_UI_FONT_ID = 'system'
export const DEFAULT_CODE_FONT_ID = 'geist-mono'

/** 正文回退链：拉丁字体缺字时落到系统西文，再落到中文系统字体。 */
const UI_TAIL =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', system-ui, sans-serif"

/** 代码回退链：等宽优先，中文注释落到系统中文再落到 monospace。 */
const MONO_TAIL =
  "ui-monospace, SFMono-Regular, 'Cascadia Mono', Consolas, 'Microsoft YaHei', monospace"

function ui(id: string, label: string, note: string, head?: string): FontFamilyOption {
  return {
    id,
    label,
    category: 'ui',
    css: head ? `${head}, ${UI_TAIL}` : UI_TAIL,
    bundled: Boolean(head),
    license: head ? 'OFL-1.1' : '系统字体',
    note
  }
}

function mono(id: string, label: string, note: string, head?: string): FontFamilyOption {
  return {
    id,
    label,
    category: 'code',
    css: head ? `${head}, ${MONO_TAIL}` : MONO_TAIL,
    bundled: Boolean(head),
    license: head ? 'OFL-1.1' : '系统字体',
    note
  }
}

/** 全局正文字体。全部 SIL OFL-1.1，可商用、可再分发。 */
export const UI_FONTS: readonly FontFamilyOption[] = [
  ui('system', '跟随系统', '不额外加载字体，用系统默认'),
  ui('geist', 'Geist', 'Vercel 出品，几何无衬线，和内置等宽同族', "'Geist'"),
  ui('inter', 'Inter', '界面字体事实标准，字面紧凑、小字号清晰', "'Inter'"),
  ui('manrope', 'Manrope', '半几何、半人文，标题有存在感', "'Manrope'"),
  ui('jakarta', 'Plus Jakarta Sans', '圆润现代，适合产品界面', "'Plus Jakarta Sans'"),
  ui('plex-sans', 'IBM Plex Sans', 'IBM 工程感，字母骨架硬朗', "'IBM Plex Sans'"),
  ui('grotesk', 'Space Grotesk', '复古科技味，开发者工具气质', "'Space Grotesk'"),
  ui('dm-sans', 'DM Sans', '低调干净，大字号不抢戏', "'DM Sans'"),
  ui('figtree', 'Figtree', '友好圆角，可读性高', "'Figtree'")
]

/** 代码字体。全部 SIL OFL-1.1，等宽对齐不发虚。 */
export const CODE_FONTS: readonly FontFamilyOption[] = [
  mono('geist-mono', 'Geist Mono', '内置默认，克制的技术感', "'Geist Mono'"),
  mono('jetbrains', 'JetBrains Mono', 'JetBrains IDE 默认，字高偏大、辨识度高', "'JetBrains Mono'"),
  mono('fira-code', 'Fira Code', '经典连字字体，=> != 会连起来', "'Fira Code'"),
  mono('plex-mono', 'IBM Plex Mono', 'IBM 工程感，斜体尤其好看', "'IBM Plex Mono'"),
  mono('source-code-pro', 'Source Code Pro', 'Adobe 出品，长行代码耐看', "'Source Code Pro'"),
  mono('red-hat-mono', 'Red Hat Mono', '几何等宽，字腔开阔', "'Red Hat Mono'"),
  mono('martian-mono', 'Martian Mono', '超宽字距，冷门但有辨识度', "'Martian Mono'"),
  mono('inconsolata', 'Inconsolata', '窄比例，一屏塞更多代码', "'Inconsolata'"),
  mono('azeret-mono', 'Azeret Mono', '方头方脑，未来感', "'Azeret Mono'"),
  mono('system-mono', '系统等宽', 'Cascadia Mono / Consolas，不加载额外字体')
]

export const DEFAULT_TYPOGRAPHY: TypographyState = {
  ui: DEFAULT_UI_FONT_ID,
  code: DEFAULT_CODE_FONT_ID
}

function optionsOf(category: FontCategory): readonly FontFamilyOption[] {
  return category === 'ui' ? UI_FONTS : CODE_FONTS
}

function fallbackIdOf(category: FontCategory): string {
  return category === 'ui' ? DEFAULT_UI_FONT_ID : DEFAULT_CODE_FONT_ID
}

/** 找不到就回落到该分类的默认字体，绝不返回 undefined。 */
export function fontOption(id: string, category: FontCategory): FontFamilyOption {
  const found = optionsOf(category).find((item) => item.id === id)
  if (found) {
    return found
  }
  return optionsOf(category).find((item) => item.id === fallbackIdOf(category))!
}

/** 把任意输入收敛成合法状态（脏 localStorage 不会让界面卡住）。 */
export function resolveTypography(input: Partial<TypographyState> | null | undefined): TypographyState {
  return {
    ui: fontOption(typeof input?.ui === 'string' ? input.ui : '', 'ui').id,
    code: fontOption(typeof input?.code === 'string' ? input.code : '', 'code').id
  }
}

export function parseTypography(raw: string | null | undefined): TypographyState {
  if (!raw) {
    return DEFAULT_TYPOGRAPHY
  }
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return DEFAULT_TYPOGRAPHY
    }
    const record = data as Record<string, unknown>
    return resolveTypography({
      ui: typeof record['ui'] === 'string' ? (record['ui'] as string) : undefined,
      code: typeof record['code'] === 'string' ? (record['code'] as string) : undefined
    })
  } catch {
    return DEFAULT_TYPOGRAPHY
  }
}

export function serializeTypography(state: TypographyState): string {
  const resolved = resolveTypography(state)
  return JSON.stringify({ ui: resolved.ui, code: resolved.code })
}

export function isDefaultTypography(state: TypographyState): boolean {
  const resolved = resolveTypography(state)
  return resolved.ui === DEFAULT_UI_FONT_ID && resolved.code === DEFAULT_CODE_FONT_ID
}

/** tokens.css 里 --font / --mono 读取的两个变量。 */
export function typographyVars(state: TypographyState): { fontUi: string; monoCode: string } {
  const resolved = resolveTypography(state)
  return {
    fontUi: fontOption(resolved.ui, 'ui').css,
    monoCode: fontOption(resolved.code, 'code').css
  }
}

/** 写入 CSS 变量的目标，测试里传个假对象即可。 */
export interface CssVarTarget {
  style: { setProperty: (name: string, value: string) => void }
}

/** 立即生效：改根元素变量，不用重渲染整棵树。 */
export function applyTypography(state: TypographyState, target: CssVarTarget): TypographyState {
  const resolved = resolveTypography(state)
  const vars = typographyVars(resolved)
  target.style.setProperty('--font-ui', vars.fontUi)
  target.style.setProperty('--mono-code', vars.monoCode)
  return resolved
}
