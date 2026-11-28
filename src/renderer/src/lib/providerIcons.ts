// lib/providerIcons —— 厂商 id → 品牌图标 key 的稳定映射。
//
// 只做映射，不 import 资源：资源加载在 components/ProviderLogo 里，
// 这样纯函数可以被单测直接调用，未知厂商永远回退 custom。
export type ProviderIconKey =
  | 'deepseek'
  | 'opencode'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'moonshot'
  | 'minimax'
  | 'zhipu'
  | 'qwen'
  | 'volcengine'
  | 'siliconflow'
  | 'openrouter'
  | 'xai'
  | 'mistral'
  | 'ollama'
  | 'lmstudio'
  | 'vllm'
  | 'codex'
  | 'claudecode'
  | 'cursor'
  | 'devin'
  | 'openclaw'
  | 'codebuddy'
  | 'paseo'
  | 'continue'
  | 'custom'

const ICON_MAP: Record<string, ProviderIconKey> = {
  // API 平台
  deepseek: 'deepseek',
  'opencode-go': 'opencode',
  openai: 'openai',
  anthropic: 'anthropic',
  gemini: 'gemini',
  moonshot: 'moonshot',
  minimax: 'minimax',
  zhipu: 'zhipu',
  qwen: 'qwen',
  volcengine: 'volcengine',
  siliconflow: 'siliconflow',
  openrouter: 'openrouter',
  xai: 'xai',
  mistral: 'mistral',
  // 本地运行时
  ollama: 'ollama',
  'lm-studio': 'lmstudio',
  vllm: 'vllm',
  // CLI 引擎
  'claude-code': 'claudecode',
  codex: 'codex',
  opencode: 'opencode',
  paseo: 'paseo',
  cursor: 'cursor',
  'kimi-cli': 'moonshot',
  'qwen-code': 'qwen',
  devin: 'devin',
  openclaw: 'openclaw',
  codebuddy: 'codebuddy',
  continue: 'continue',
  'mistral-vibe': 'mistral',
  'custom-command': 'custom'
}

/** 未知厂商稳定回退 custom，永不破图。 */
export function providerIconKey(providerId: string | null | undefined): ProviderIconKey {
  if (!providerId) {
    return 'custom'
  }
  return ICON_MAP[providerId] ?? 'custom'
}
