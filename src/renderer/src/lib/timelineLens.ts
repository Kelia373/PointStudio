// lib/timelineLens —— 长回答的「过程 / 结论」双轨切分，以及按天聚拢的时间线。
//
// 渲染层要能在原地换镜头：同一块地方，一会儿显示推理过程，一会儿显示结论，
// 而不是把长回答整个铺开让用户自己找重点。切分规则是纯函数，方便单测。

export type LensMode = 'conclusion' | 'process'

export interface TrackSplit {
  /** 推理/步骤，逐段。 */
  process: string[]
  /** 最终结论，单独一段。 */
  conclusion: string
}

export interface TimelineEntry {
  id: string
  title: string
  at: string
}

const CONCLUSION_MARK = /(结论|综上|总结)[：:]\s*/
/** 低于这个长度的回答不值得折叠——折叠本身也是成本。 */
const COLLAPSE_MIN_CHARS = 240

function toParagraphs(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

export function splitProcessAndConclusion(text: string): TrackSplit {
  const normalized = (text ?? '').replace(/\r\n/g, '\n').trim()
  if (normalized === '') {
    return { process: [], conclusion: '' }
  }

  const match = CONCLUSION_MARK.exec(normalized)
  if (match && match.index > 0) {
    const before = normalized.slice(0, match.index).trim()
    const after = normalized.slice(match.index + match[0].length).trim()
    return {
      process: toParagraphs(before),
      conclusion: after === '' ? before : after
    }
  }

  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (paragraphs.length <= 1) {
    return { process: [], conclusion: normalized }
  }

  return {
    process: paragraphs.slice(0, -1),
    conclusion: paragraphs[paragraphs.length - 1]
  }
}

/** 有过程轨、且够长——两个条件都满足才值得给「换镜头」入口。 */
export function shouldCollapse(split: TrackSplit, text: string): boolean {
  return split.process.length > 0 && text.trim().length > COLLAPSE_MIN_CHARS
}

export interface TimelineGroup {
  day: string
  items: TimelineEntry[]
}

/** 按天分组，新的一天在前；组内按时间倒序。 */
export function groupTimelineByDay(entries: TimelineEntry[]): TimelineGroup[] {
  const buckets = new Map<string, TimelineEntry[]>()
  for (const entry of entries) {
    const day = entry.at.slice(0, 10)
    const list = buckets.get(day) ?? []
    list.push(entry)
    buckets.set(day, list)
  }

  return [...buckets.entries()]
    .map(([day, items]) => ({
      day,
      items: [...items].sort((a, b) => b.at.localeCompare(a.at))
    }))
    .sort((a, b) => b.day.localeCompare(a.day))
}

/** 镜头切换：结论 ⇄ 过程。缺省是结论。 */
export function toggleLens(previous: Record<string, LensMode>, messageId: string): Record<string, LensMode> {
  const current = previous[messageId] ?? 'conclusion'
  return { ...previous, [messageId]: current === 'conclusion' ? 'process' : 'conclusion' }
}
