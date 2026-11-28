// 厂商品牌图标：MIT 来源（@lobehub/icons-static-svg）+ 少量自绘几何兜底。
//
// 图标统一塞进 --panel-2 圆角底板；未知厂商回退 custom，永不出现 <img> 破图。
import deepseek from '../assets/providers/deepseek.svg?raw'
import opencode from '../assets/providers/opencode.svg?raw'
import openai from '../assets/providers/openai.svg?raw'
import anthropic from '../assets/providers/anthropic.svg?raw'
import gemini from '../assets/providers/gemini.svg?raw'
import moonshot from '../assets/providers/moonshot.svg?raw'
import minimax from '../assets/providers/minimax.svg?raw'
import zhipu from '../assets/providers/zhipu.svg?raw'
import qwen from '../assets/providers/qwen.svg?raw'
import volcengine from '../assets/providers/volcengine.svg?raw'
import siliconflow from '../assets/providers/siliconflow.svg?raw'
import openrouter from '../assets/providers/openrouter.svg?raw'
import xai from '../assets/providers/xai.svg?raw'
import mistral from '../assets/providers/mistral.svg?raw'
import ollama from '../assets/providers/ollama.svg?raw'
import lmstudio from '../assets/providers/lmstudio.svg?raw'
import vllm from '../assets/providers/vllm.svg?raw'
import codex from '../assets/providers/codex.svg?raw'
import claudecode from '../assets/providers/claudecode.svg?raw'
import cursor from '../assets/providers/cursor.svg?raw'
import devin from '../assets/providers/devin.svg?raw'
import openclaw from '../assets/providers/openclaw.svg?raw'
import codebuddy from '../assets/providers/codebuddy.svg?raw'
import paseo from '../assets/providers/paseo.svg?raw'
import continueIcon from '../assets/providers/continue.svg?raw'
import custom from '../assets/providers/custom.svg?raw'
import { providerIconKey, type ProviderIconKey } from '../lib/providerIcons'

const ICONS: Record<ProviderIconKey, string> = {
  deepseek,
  opencode,
  openai,
  anthropic,
  gemini,
  moonshot,
  minimax,
  zhipu,
  qwen,
  volcengine,
  siliconflow,
  openrouter,
  xai,
  mistral,
  ollama,
  lmstudio,
  vllm,
  codex,
  claudecode,
  cursor,
  devin,
  openclaw,
  codebuddy,
  paseo,
  continue: continueIcon,
  custom
}

/** 把 1em 尺寸换成 100%，其余属性（含品牌色）原样保留。 */
function scaled(raw: string): string {
  return raw
    .replace(/width="1em"/g, 'width="100%"')
    .replace(/height="1em"/g, 'height="100%"')
    .replace(/style="[^"]*"/g, '')
}

export default function ProviderLogo({
  providerId,
  size = 24,
  className = ''
}: {
  providerId: string | null | undefined
  size?: number
  className?: string
}) {
  const key = providerIconKey(providerId)
  return (
    <span
      className={`provider-logo${className === '' ? '' : ` ${className}`}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: scaled(ICONS[key]) }}
    />
  )
}
