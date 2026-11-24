// 标注纯函数：把界面上的标注拼成一段可以直接粘给人看的文本。
//
// 放 lib 而不是组件文件里，是为了能在 node 单测里直接跑（组件文件带 JSX，
// `--experimental-strip-types` 不处理 JSX）。
export interface AnnotationItem {
  id: string
  /** 人类可读的元素描述：`<button.msg__act> “复制”` */
  target: string
  tag: string
  note: string
}

export const ANNOTATION_TAGS = [
  '位置不对',
  '太大',
  '太小',
  '太挤',
  '太松',
  '层级不对',
  '文案要改',
  '其他'
] as const

/**
 * 拼成编号列表，一条一行。
 * 备注为空时不留下多余的破折号——粘到聊天里不会出现 `—— ` 这种尾巴。
 */
export function toPlainText(items: AnnotationItem[]): string {
  return items
    .map((item, index) => {
      const head = `${index + 1}. [${item.tag}] ${item.target}`
      const note = item.note.trim()
      return note === '' ? head : `${head} —— ${note}`
    })
    .join('\n')
}
