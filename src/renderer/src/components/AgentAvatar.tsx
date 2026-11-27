// Agent 头像：优先用精选的 Fluent 3D 图标（MIT，128×128 WebP），
// 加载失败再退回 lib/agentAvatar 生成的单色几何头像。
// 选择逻辑是纯函数，这里只负责把 key 映射到打包后的资源地址。
import { useState } from 'react'

import bolt from '../assets/avatars/fluent-3d/bolt.webp'
import books from '../assets/avatars/fluent-3d/books.webp'
import brain from '../assets/avatars/fluent-3d/brain.webp'
import bulb from '../assets/avatars/fluent-3d/bulb.webp'
import chart from '../assets/avatars/fluent-3d/chart.webp'
import clipboard from '../assets/avatars/fluent-3d/clipboard.webp'
import compass from '../assets/avatars/fluent-3d/compass.webp'
import eye from '../assets/avatars/fluent-3d/eye.webp'
import fox from '../assets/avatars/fluent-3d/fox.webp'
import gear from '../assets/avatars/fluent-3d/gear.webp'
import hammerWrench from '../assets/avatars/fluent-3d/hammer-wrench.webp'
import key from '../assets/avatars/fluent-3d/key.webp'
import lock from '../assets/avatars/fluent-3d/lock.webp'
import magnifier from '../assets/avatars/fluent-3d/magnifier.webp'
import owl from '../assets/avatars/fluent-3d/owl.webp'
import packageIcon from '../assets/avatars/fluent-3d/package.webp'
import penguin from '../assets/avatars/fluent-3d/penguin.webp'
import robot from '../assets/avatars/fluent-3d/robot.webp'
import rocket from '../assets/avatars/fluent-3d/rocket.webp'
import satellite from '../assets/avatars/fluent-3d/satellite.webp'
import shield from '../assets/avatars/fluent-3d/shield.webp'
import target from '../assets/avatars/fluent-3d/target.webp'
import telescope from '../assets/avatars/fluent-3d/telescope.webp'
import testTube from '../assets/avatars/fluent-3d/test-tube.webp'
import triangularRuler from '../assets/avatars/fluent-3d/triangular-ruler.webp'
import warning from '../assets/avatars/fluent-3d/warning.webp'
import { pickAgentAvatar, seededAvatarSvg, type AvatarKey } from '../lib/agentAvatar'

export const AVATAR_SOURCES: Record<AvatarKey, string> = {  'triangular-ruler': triangularRuler,
  'hammer-wrench': hammerWrench,
  'test-tube': testTube,
  magnifier,
  package: packageIcon,
  rocket,
  books,
  chart,
  shield,
  warning,
  bolt,
  compass,
  clipboard,
  target,
  bulb,
  robot,
  brain,
  eye,
  gear,
  key,
  lock,
  telescope,
  satellite,
  owl,
  fox,
  penguin
}

export default function AgentAvatar({
  agentId,
  name,
  avatar = null,
  size = 16,
  className = ''
}: {
  agentId: string
  name: string
  /** 手选的 3D 头像 key；null 走自动匹配。 */
  avatar?: string | null
  size?: number
  className?: string
}) {
  const avatarKey = pickAgentAvatar(agentId, name, avatar)
  // 只记住失败的那一个 key：换 Agent 后自动回到图片，不需要额外的副作用
  const [failedKey, setFailedKey] = useState<string | null>(null)
  const failed = failedKey === avatarKey

  return (
    <span
      className={`agent-avatar${className === '' ? '' : ` ${className}`}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {failed ? (
        <span
          className="agent-avatar__seeded"
          dangerouslySetInnerHTML={{ __html: seededAvatarSvg(agentId || name) }}
        />
      ) : (
        <img
          src={AVATAR_SOURCES[avatarKey]}
          alt=""
          width={size}
          height={size}
          draggable={false}
          onError={() => setFailedKey(avatarKey)}
        />
      )}
    </span>
  )
}
