// ai/domain/chat —— 会话相关的纯逻辑。
//
// 约束（见 ai/domain.md）：不许 import electron / react，不许读写文件、数据库、网络。
// 这个文件里只有「输入 → 输出」的函数，因此可以脱离 Electron 单测，也能被企业版直接复用。

/**
 * 把一段文本按固定长度切成若干块，用于模拟 / 消费流式输出。
 *
 * 按**码点**切而不是按 UTF-16 单元切：`text.slice()` 会把 emoji 的代理对劈成两半，
 * 界面上就会冒出 `` 这种乱码。Array.from 先展开成码点数组，再按块拼回去。
 *
 * @param text 待切分文本；空串返回空数组
 * @param size 每块的最大码点数，必须是 >= 1 的整数
 * @throws RangeError 当 size 不是正整数
 */
export function splitIntoChunks(text: string, size: number): string[] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError(`chunk size 必须是 >= 1 的整数，收到 ${size}`)
  }
  if (text === '') {
    return []
  }

  const codePoints = Array.from(text)
  const chunks: string[] = []
  for (let index = 0; index < codePoints.length; index += size) {
    chunks.push(codePoints.slice(index, index + size).join(''))
  }
  return chunks
}
