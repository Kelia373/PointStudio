// lib/agentAvatar —— Agent 头像的确定性选择（纯函数，不碰 React / 文件系统）。
//
// 两条轨：
// 1. 名字（或 role 关键词）能认出来 → 用精选的 Fluent 3D 角色图标；
// 2. 认不出来 → 按 id 做 FNV-1a 哈希，稳定落到同一张，不会每次刷新换脸。
// 图片本身在 assets/avatars/fluent-3d/，由 components/AgentAvatar.tsx 负责加载；
// 万一加载失败，再退回这里生成的单色几何 SVG。
export type AvatarKey =
  | 'triangular-ruler'
  | 'hammer-wrench'
  | 'test-tube'
  | 'magnifier'
  | 'package'
  | 'rocket'
  | 'books'
  | 'chart'
  | 'shield'
  | 'warning'
  | 'bolt'
  | 'compass'
  | 'clipboard'
  | 'target'
  | 'bulb'
  | 'robot'
  | 'brain'
  | 'eye'
  | 'gear'
  | 'key'
  | 'lock'
  | 'telescope'
  | 'satellite'
  | 'owl'
  | 'fox'
  | 'penguin'

export const AVATAR_KEYS: AvatarKey[] = [
  'triangular-ruler',
  'hammer-wrench',
  'test-tube',
  'magnifier',
  'package',
  'rocket',
  'books',
  'chart',
  'shield',
  'warning',
  'bolt',
  'compass',
  'clipboard',
  'target',
  'bulb',
  'robot',
  'brain',
  'eye',
  'gear',
  'key',
  'lock',
  'telescope',
  'satellite',
  'owl',
  'fox',
  'penguin'
]

/** 关键词顺序即优先级：越具体的角色越靠前，'bot' 这种泛词必须放最后。 */
const KEYWORDS: Array<[string, AvatarKey]> = [
  ['架构', 'triangular-ruler'],
  ['architect', 'triangular-ruler'],
  ['开发', 'hammer-wrench'],
  ['编码', 'hammer-wrench'],
  ['coder', 'hammer-wrench'],
  ['dev', 'hammer-wrench'],
  ['测试', 'test-tube'],
  ['test', 'test-tube'],
  ['qa', 'test-tube'],
  ['素材', 'magnifier'],
  ['检索', 'magnifier'],
  ['搜索', 'magnifier'],
  ['research', 'magnifier'],
  ['search', 'magnifier'],
  ['依赖', 'package'],
  ['package', 'package'],
  ['deps', 'package'],
  ['部署', 'rocket'],
  ['发布', 'rocket'],
  ['deploy', 'rocket'],
  ['release', 'rocket'],
  ['文档', 'books'],
  ['doc', 'books'],
  ['数据', 'chart'],
  ['报表', 'chart'],
  ['data', 'chart'],
  ['chart', 'chart'],
  ['安全', 'shield'],
  ['security', 'shield'],
  ['告警', 'warning'],
  ['警告', 'warning'],
  ['alert', 'warning'],
  ['性能', 'bolt'],
  ['performance', 'bolt'],
  ['perf', 'bolt'],
  ['路由', 'compass'],
  ['编排', 'compass'],
  ['orchestrat', 'compass'],
  ['route', 'compass'],
  ['计划', 'clipboard'],
  ['任务', 'clipboard'],
  ['plan', 'clipboard'],
  ['目标', 'target'],
  ['target', 'target'],
  ['创意', 'bulb'],
  ['idea', 'bulb'],
  ['大脑', 'brain'],
  ['brain', 'brain'],
  ['眼睛', 'eye'],
  ['观察', 'eye'],
  ['eye', 'eye'],
  ['设置', 'gear'],
  ['settings', 'gear'],
  ['权限', 'key'],
  ['key', 'key'],
  ['锁', 'lock'],
  ['私密', 'lock'],
  ['lock', 'lock'],
  ['探索', 'telescope'],
  ['explore', 'telescope'],
  ['远程', 'satellite'],
  ['remote', 'satellite'],
  ['猫头鹰', 'owl'],
  ['owl', 'owl'],
  ['狐狸', 'fox'],
  ['fox', 'fox'],
  ['企鹅', 'penguin'],
  ['penguin', 'penguin'],
  ['机器人', 'robot'],
  ['bot', 'robot']
]

/** FNV-1a 32 位：短、稳、跨平台一致，不需要引入哈希库。 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** 名字优先，认不出来再按 id 哈希。同一个 Agent 永远拿到同一张。 */
export function isAvatarKey(value: string): value is AvatarKey {
  return (AVATAR_KEYS as string[]).includes(value)
}

export function pickAgentAvatar(
  agentId: string,
  name: string,
  preferredAvatar?: string | null
): AvatarKey {
  // 手选优先：只有合法的 AvatarKey 才认，脏字符串回退到自动匹配
  if (preferredAvatar && isAvatarKey(preferredAvatar)) {
    return preferredAvatar
  }
  const haystack = name.toLowerCase()
  if (haystack !== '') {
    for (const [needle, key] of KEYWORDS) {
      if (haystack.includes(needle)) {
        return key
      }
    }
  }
  return AVATAR_KEYS[hashString(agentId || name) % AVATAR_KEYS.length]
}

/**
 * 兜底头像：5×5 镜像点阵，只用 currentColor + 透明度，跟着主题走。
 * 返回 SVG 字符串，调用方用 innerHTML 挂载；内容完全由哈希决定，无外部输入。
 */
export function seededAvatarSvg(seed: string): string {
  const hash = hashString(seed)
  const shapes: string[] = []
  const size = 8
  let state = hash === 0 ? 0x9e3779b9 : hash

  for (let row = 0; row < 5; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      if (((state >>> 16) & 1) === 0) {
        continue
      }
      const opacity = [0.9, 0.55, 0.28][(state >>> 17) % 3]
      const draw = (x: number): string =>
        `<rect x="${x * size}" y="${row * size}" width="${size}" height="${size}" rx="3" ` +
        `fill="currentColor" opacity="${opacity}"/>`
      shapes.push(draw(col))
      if (col < 2) {
        shapes.push(draw(4 - col))
      }
    }
  }

  // 全空会让头像变成一块空白：至少给中心补一格
  if (shapes.length === 0) {
    shapes.push(
      '<rect x="16" y="16" width="8" height="8" rx="3" fill="currentColor" opacity="0.55"/>'
    )
  }

  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40" ' +
    'aria-hidden="true" focusable="false">' +
    shapes.join('') +
    '</svg>'
  )
}
