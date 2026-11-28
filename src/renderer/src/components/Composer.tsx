// 输入区：三态（发送 / 流式中 / 停止）+ 高度自适应 + Enter 发送。
// 群聊支持 @ 成员（被选中的人以高亮 chip 展示，发送时由该成员接管本轮）；
// 同时支持 / 指令：/plan 生成计划、/stop 停止生成、/clear 清空输入。
//
// 文本框是 contentEditable 的「行内原子胶囊」编辑区：`[Image #N]` 在界面上
// 是一颗不可拆的胶囊（图标 + 「图片 #N」），光标整颗跳过、退格整颗删除。
// 字符串仍然是唯一事实来源（draft），DOM 只是它的投影；两边对不上时
// 立即按 draft 重建，并恢复逻辑光标——这样删掉前面的图后，剩余胶囊
// 会当帧重排成 #1..#k，永远不会和上方缩略图错位。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { EFFORT_LABEL, MODEL_LABEL, type Effort } from '../lib/modelOptions'
import { resolveComposerAction } from '../lib/composerCommands'
import type { ComposerModelPolicy } from '../lib/modelPicker'
import { Slot } from '../runtime/SlotRenderer'
import Icon from './Icon'
import { ImageLightbox, type LightboxState } from './ChatImages'
import {
  deleteTokenAtCaret,
  insertImageTokenAtCaret,
  removeImageSlot,
  syncImagesWithText,
  type PendingImage
} from '../lib/imageTokens'
import {
  getLogicalCaretOffset,
  parseEditorSegments,
  serializeEditorNodes,
  setLogicalCaretOffset,
  type EditorDomNode
} from '../lib/inlineChipEditor'
import { describeError } from '../../../shared/i18n/errors.ts'

interface MentionCandidate {
  id: string
  name: string
}

interface SlashCommand {
  command: string
  label: string
}

const COMMANDS: SlashCommand[] = [
  { command: '/plan', label: '生成执行计划' },
  { command: '/stop', label: '停止生成' },
  { command: '/clear', label: '清空输入' }
]

const SVG_NS = 'http://www.w3.org/2000/svg'
const CHIP_SLOT = 'data-image-slot'
const SENTINEL = 'data-sentinel'

interface MenuState {
  kind: 'mention' | 'command'
  /** 触发位置：@ 或 / 在文本里的下标。 */
  start: number
  query: string
  active: number
}

/** 真实 DOM 子节点 → 纯数据节点（序列化 / 光标换算用）。 */
function toEditorNode(node: ChildNode): EditorDomNode {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    // 文本节点原样保留；注释等其它节点当空文本，避免把标签名读崩。
    return { kind: 'text', text: node.nodeType === Node.TEXT_NODE ? node.textContent ?? '' : '' }
  }
  const element = node as Element
  const attrs: Record<string, string | null> = {}
  if (element.hasAttribute(CHIP_SLOT)) {
    attrs[CHIP_SLOT] = element.getAttribute(CHIP_SLOT)
  }
  if (element.hasAttribute(SENTINEL)) {
    attrs[SENTINEL] = element.getAttribute(SENTINEL)
  }
  return {
    kind: 'element',
    tag: element.tagName.toLowerCase(),
    attrs,
    children: Array.from(element.childNodes).map(toEditorNode)
  }
}

function toEditorNodes(list: ArrayLike<ChildNode>): EditorDomNode[] {
  return Array.from(list).map(toEditorNode)
}

function readEditor(el: HTMLElement): string {
  return serializeEditorNodes(toEditorNodes(el.childNodes))
}

/** 逻辑光标 → 真实 Selection。路径由 setLogicalCaretOffset 给出。 */
function resolvePath(root: Node, path: ReadonlyArray<number>): Node | null {
  let node: Node = root
  for (const index of path) {
    const next: Node | undefined = node.childNodes[index]
    if (next === undefined) {
      return null
    }
    node = next
  }
  return node
}

function pathTo(root: HTMLElement, node: Node): number[] | null {
  const path: number[] = []
  let current: Node | null = node
  while (current !== null && current !== root) {
    const parent: Node | null = current.parentNode
    if (parent === null) {
      return null
    }
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current) as number)
    current = parent
  }
  return current === root ? path : null
}

function caretOffsetOf(el: HTMLElement): number | null {
  const selection = window.getSelection()
  if (selection === null || selection.rangeCount === 0) {
    return null
  }
  const range = selection.getRangeAt(0)
  if (!el.contains(range.startContainer)) {
    return null
  }
  const path = pathTo(el, range.startContainer)
  if (path === null) {
    return null
  }
  return getLogicalCaretOffset(toEditorNodes(el.childNodes), path, range.startOffset)
}

function applyCaret(el: HTMLElement, offset: number): void {
  const caret = setLogicalCaretOffset(toEditorNodes(el.childNodes), offset)
  const node = resolvePath(el, caret.path) ?? el
  const selection = window.getSelection()
  if (selection === null) {
    return
  }
  const range = document.createRange()
  range.setStart(node, caret.offset)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

/**
 * 胶囊图标：用 DOM API 建 SVG（Lucide 相框山峰），
 * 不经 dangerouslySetInnerHTML——渲染层红线不允许。
 */
function buildChipIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '12')
  svg.setAttribute('height', '12')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', 'currentColor')
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const rect = document.createElementNS(SVG_NS, 'rect')
  rect.setAttribute('width', '18')
  rect.setAttribute('height', '18')
  rect.setAttribute('x', '3')
  rect.setAttribute('y', '3')
  rect.setAttribute('rx', '2')
  rect.setAttribute('ry', '2')

  const circle = document.createElementNS(SVG_NS, 'circle')
  circle.setAttribute('cx', '9')
  circle.setAttribute('cy', '9')
  circle.setAttribute('r', '2')

  const path = document.createElementNS(SVG_NS, 'path')
  path.setAttribute('d', 'm21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21')

  svg.append(rect, circle, path)
  return svg
}

function buildChip(slot: number): HTMLSpanElement {
  const chip = document.createElement('span')
  chip.className = 'image-chip composer__inline-chip'
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute(CHIP_SLOT, String(slot))
  chip.setAttribute('title', '点击放大预览')
  chip.append(buildChipIcon())
  chip.append(document.createTextNode(` 图片 #${slot}`))
  return chip
}

/** 按 draft 重建编辑区 DOM：文字 / 换行 / 胶囊。 */
function renderEditor(el: HTMLElement, draft: string, images: PendingImage[]): void {
  const known = new Set(images.map((image) => image.index))
  const fragment = document.createDocumentFragment()
  for (const segment of parseEditorSegments(draft)) {
    if (segment.type === 'text') {
      fragment.append(document.createTextNode(segment.value))
    } else if (segment.type === 'br') {
      fragment.append(document.createElement('br'))
    } else if (known.has(segment.slot)) {
      fragment.append(buildChip(segment.slot))
    } else {
      // 找不到实体的引用退化成原文，避免出现「点开是别张图」的假胶囊。
      fragment.append(document.createTextNode(`[Image #${segment.slot}]`))
    }
  }
  // 末尾留一个撑行哨兵：否则空行 / 空输入框里光标没有落点。
  if (draft === '' || draft.endsWith('\n')) {
    const sentinel = document.createElement('br')
    sentinel.setAttribute(SENTINEL, '1')
    fragment.append(sentinel)
  }
  el.replaceChildren(fragment)
}

function imageFilesOf(data: DataTransfer | null): File[] {
  if (data === null) {
    return []
  }
  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

export default function Composer({
  draft,
  busy,
  canSend,
  model,
  models,
  effort,
  onDraftChange,
  onSend,
  onStop,
  onPlan,
  routePreview,
  onModelChange,
  onEffortChange,
  modelPolicy,
  modelBadge,
  modelPicker,
  mentionCandidates,
  mentionedIds,
  onMentionedChange,
  images = [],
  onImagesChange
}: {
  draft: string
  busy: boolean
  canSend: boolean
  /** 当前会话生效的模型名（可能来自会话覆盖或全局默认）。 */
  model: string
  /** 下拉可选项，第一项是当前值。 */
  models: string[]
  /** 当前思考等级；null 表示没设过。 */
  effort: Effort | null
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onPlan: (goal?: string) => void
  /** 发送前的路由预判文案；null 表示不显示。 */
  routePreview?: string | null
  /**
   * 老下拉分支用的模型回调。
   * 注意：本组 prop（onModelChange / model / models）只在 `modelPolicy === undefined` 时被读取，
   * 而 ChatPanel 现在恒传 modelPolicy（且 resolveConversationComposerPolicy 带 defaultAssistantId，
   * 恒返回 locked-*），所以现网这两条分支都不可达。已定：保留，勿删（不破 chat.composer 契约）。
   */
  onModelChange: (model: string) => void
  onEffortChange: (effort: Effort) => void
  /** 会话类型决定模型入口：可编辑 / 锁定 Agent / 锁定小组。 */
  modelPolicy?: ComposerModelPolicy
  /** 锁定态显示的只读徽标。 */
  modelBadge?: ReactNode
  /** 可编辑态渲染的模型选择浮层（现网不可达，同上）。 */
  modelPicker?: ReactNode
  /** 群聊成员：输入 @ 时弹出。 */
  mentionCandidates?: MentionCandidate[]
  /** 已被 @ 的成员 id（由上层持有，发送时用来路由）。 */
  mentionedIds?: string[]
  onMentionedChange?: (ids: string[]) => void
  /** 待发图片（受控；不传时输入框不显示图片功能）。 */
  images?: PendingImage[]
  onImagesChange?: (next: PendingImage[]) => void
}) {
  const editorRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<LightboxState | null>(null)
  const isComposingRef = useRef(false)
  /** 上一次投影到 DOM 的胶囊编号：编号变了也要重建（文字可能没变）。 */
  const renderedSlotsRef = useRef<string>('')
  /** 程序化改 draft 之后要落的光标位置；重建 DOM 时消费。 */
  const pendingCaretRef = useRef<number | null>(null)
  const MAX_IMAGE_BYTES = 10 * 1024 * 1024
  const MAX_IMAGES = 6
  const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

  const candidates = mentionCandidates ?? []
  const mentioned = mentionedIds ?? []
  const slotKey = images.map((image) => image.index).join(',')

  /** 后缀优先：.svg 一律拒，哪怕 File.type 写着 image/png（宁可多拦一次）。 */
  function mimeOf(file: File): string {
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (ext === 'svg') {
      return 'image/svg+xml'
    }
    const byExt =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'png' || ext === 'webp' || ext === 'gif'
          ? `image/${ext}`
          : ''
    if (file.type !== '' && ALLOWED.includes(file.type)) {
      return file.type
    }
    return byExt
  }

  function readAsDataUrl(file: File): Promise<string | null> {
    return new Promise((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null)
      reader.onerror = () => resolve(null)
      reader.readAsDataURL(file)
    })
  }

  function currentCaret(fallback: number): number {
    const el = editorRef.current
    if (el === null || document.activeElement !== el) {
      return fallback
    }
    return caretOffsetOf(el) ?? fallback
  }

  /** 在逻辑光标处插入纯文本（粘贴 / Shift+Enter 共用）。 */
  function insertPlainText(text: string): void {
    const caret = currentCaret(draft.length)
    const next = `${draft.slice(0, caret)}${text}${draft.slice(caret)}`
    onDraftChange(next)
    pendingCaretRef.current = caret + text.length
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      if (editorRef.current !== null) {
        applyCaret(editorRef.current, caret + text.length)
      }
    })
  }

  /** 把已落盘的图片追加成待发图，并在光标处补占位符。 */
  function appendImages(
    incoming: ReadonlyArray<{ image: PendingImage['dto']; previewUrl: string }>
  ): void {
    if (onImagesChange === undefined) {
      return
    }
    const room = MAX_IMAGES - images.length
    if (room <= 0) {
      setHint(`一条消息最多 ${MAX_IMAGES} 张图片`)
      return
    }
    const take = incoming.slice(0, room)
    if (take.length === 0) {
      return
    }
    const inserted: PendingImage[] = take.map((item, offset) => ({
      index: images.length + offset + 1,
      dto: item.image,
      previewUrl: item.previewUrl
    }))
    onImagesChange([...images, ...inserted])

    let caret = currentCaret(draft.length)
    let text = draft
    for (const image of inserted) {
      const placed = insertImageTokenAtCaret(text, caret, image.index)
      text = placed.nextText
      caret = placed.nextCaret
    }
    onDraftChange(text)
    pendingCaretRef.current = caret
    setHint(null)
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      if (editorRef.current !== null) {
        applyCaret(editorRef.current, caret)
      }
    })
  }

  async function addFiles(files: File[]): Promise<void> {
    if (onImagesChange === undefined) {
      return
    }
    try {
      const next = [...images]
      const inserted: PendingImage[] = []
      for (const file of files) {
        const mime = mimeOf(file)
        if (!ALLOWED.includes(mime)) {
          setHint('只支持 PNG / JPEG / WebP / GIF（SVG 不可用）')
          continue
        }
        if (file.size > MAX_IMAGE_BYTES) {
          setHint('单张图片不能超过 10 MB')
          continue
        }
        if (next.length + inserted.length >= MAX_IMAGES) {
          setHint(`一条消息最多 ${MAX_IMAGES} 张图片`)
          break
        }
        const previewUrl = await readAsDataUrl(file)
        if (previewUrl === null) {
          setHint('读取图片失败')
          continue
        }
        const saved = await window.pointstudio.attachments.save({
          dataUrl: previewUrl,
          name: file.name
        })
        if (!saved.ok) {
          setHint(describeError(saved.code))
          continue
        }
        const index = next.length + inserted.length + 1
        inserted.push({ index, dto: saved.value, previewUrl })
      }
      if (inserted.length === 0) {
        return
      }
      appendImages(inserted.map((item) => ({ image: item.dto, previewUrl: item.previewUrl })))
    } catch {
      // 桥接缺失（preload 还是旧的）或落盘异常：显式说清，不再静默吞掉。
      setHint('图片保存失败，请重启一次应用（preload 可能未更新）')
    }
  }

  /** 剪贴板兜底：截图工具的位图 / 资源管理器复制的文件，渲染层拿不到 File。 */
  async function pasteFromClipboard(): Promise<void> {
    if (onImagesChange === undefined) {
      return
    }
    try {
      const result = await window.pointstudio.attachments.pasteClipboard()
      if (!result.ok) {
        setHint(describeError(result.code))
        return
      }
      if (result.value.length === 0) {
        return
      }
      appendImages(result.value)
    } catch {
      setHint('读取剪贴板图片失败，请重启一次应用（preload 可能未更新）')
    }
  }

  function removeSlot(slot: number): void {
    if (onImagesChange === undefined) {
      return
    }
    const next = removeImageSlot(draft, images, slot)
    onDraftChange(next.text)
    onImagesChange(next.images)
  }

  // 投影同步：draft / 胶囊编号与 DOM 不一致时按 draft 重建并恢复光标。
  useLayoutEffect(() => {
    const el = editorRef.current
    if (el === null || isComposingRef.current) {
      return
    }
    const rendered = readEditor(el)
    if (rendered === draft && renderedSlotsRef.current === slotKey) {
      return
    }
    const focused = document.activeElement === el
    const caret = focused ? caretOffsetOf(el) : null
    renderEditor(el, draft, images)
    renderedSlotsRef.current = slotKey
    if (pendingCaretRef.current !== null) {
      applyCaret(el, pendingCaretRef.current)
      pendingCaretRef.current = null
    } else if (focused && caret !== null) {
      applyCaret(el, caret)
    }
  }, [draft, images, slotKey])

  // 高度自适应：内容长高就长高，但不超过 CSS 的 max-height。
  useEffect(() => {
    const node = editorRef.current
    if (!node) {
      return
    }
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [draft])

  function findMention(value: string, caret: number): MenuState | null {
    if (candidates.length === 0) {
      return null
    }
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at < 0) {
      return null
    }
    const query = before.slice(at + 1)
    // @ 后面不能出现空白，否则视为普通文本。
    if (/\s/.test(query)) {
      return null
    }
    return { kind: 'mention', start: at, query, active: 0 }
  }

  function findCommand(value: string): MenuState | null {
    if (!value.startsWith('/') || /\s/.test(value) || value.length > 20) {
      return null
    }
    return { kind: 'command', start: 0, query: value, active: 0 }
  }

  function refreshMenu(value: string, caret: number): void {
    setMenu(findCommand(value) ?? findMention(value, caret))
  }

  const mentionMatches =
    menu?.kind === 'mention'
      ? candidates.filter((item) =>
          item.name.toLowerCase().includes(menu.query.toLowerCase())
        )
      : []
  const commandMatches =
    menu?.kind === 'command'
      ? COMMANDS.filter((item) => item.command.startsWith(menu.query.toLowerCase()))
      : []
  const menuItems = menu?.kind === 'mention' ? mentionMatches.length : commandMatches.length
  const activeIndex = menu ? Math.min(menu.active, Math.max(0, menuItems - 1)) : 0

  function applyMention(candidate: MentionCandidate): void {
    const caret = currentCaret(draft.length)
    const start = menu?.start ?? draft.lastIndexOf('@')
    const next = `${draft.slice(0, start)}@${candidate.name} ${draft.slice(caret)}`
    onDraftChange(next)
    if (!mentioned.includes(candidate.id)) {
      onMentionedChange?.([...mentioned, candidate.id])
    }
    setMenu(null)
    const position = start + candidate.name.length + 2
    pendingCaretRef.current = position
    requestAnimationFrame(() => {
      editorRef.current?.focus()
      if (editorRef.current !== null) {
        applyCaret(editorRef.current, position)
      }
    })
  }

  function applyCommand(command: string): void {
    setMenu(null)
    if (command === '/plan') {
      // 从菜单选中 /plan 时补全成 '/plan ' 并聚焦，不立即发起规划。
      onDraftChange('/plan ')
      setHint(null)
      pendingCaretRef.current = '/plan '.length
      requestAnimationFrame(() => {
        editorRef.current?.focus()
        if (editorRef.current !== null) {
          applyCaret(editorRef.current, '/plan '.length)
        }
      })
      return
    }
    if (command === '/stop') {
      // 菜单里点 /stop 也按「生成中可用」处理。
      if (busy) {
        onStop()
      } else {
        setHint('当前没有进行中的生成')
      }
      onDraftChange('')
      return
    }
    onDraftChange('')
  }

  /** Enter / 发送按钮共用：先解析指令，再决定发送、停止还是拦截。 */
  function handleSubmitAction(): void {
    const action = resolveComposerAction(draft, busy)
    if (action.type === 'blocked') {
      return
    }
    if (action.type === 'stop') {
      if (busy) {
        onStop()
      } else {
        setHint('当前没有进行中的生成')
      }
      onDraftChange('')
      return
    }
    if (action.type === 'clear') {
      onDraftChange('')
      return
    }
    if (action.type === 'plan-needs-goal') {
      setHint('在 /plan 后面写目标，例如：/plan 修复登录')
      return
    }
    if (action.type === 'plan') {
      onPlan(action.goal)
      onDraftChange('')
      return
    }
    onSend()
  }

  function removeMention(candidate: MentionCandidate): void {
    onMentionedChange?.(mentioned.filter((id) => id !== candidate.id))
    const token = `@${candidate.name}`
    const index = draft.indexOf(token)
    if (index < 0) {
      return
    }
    const end = index + token.length
    // 只吃掉 @名字 后面那一个分隔空格，不动用户自己的排版。
    onDraftChange(draft.slice(0, index) + draft.slice(draft[end] === ' ' ? end + 1 : end))
  }

  /** 编辑区的 input：把 DOM 还原成 draft，并让缩略图跟着图标签增删。 */
  function handleEditorInput(): void {
    const el = editorRef.current
    if (el === null || isComposingRef.current) {
      return
    }
    const value = readEditor(el)
    const caret = caretOffsetOf(el) ?? value.length
    setHint(null)

    let nextValue = value
    if (onImagesChange !== undefined && images.length > 0) {
      const synced = syncImagesWithText(value, images)
      if (synced.images.length !== images.length) {
        onImagesChange(synced.images)
      }
      nextValue = synced.text
    }
    onDraftChange(nextValue)
    refreshMenu(nextValue, caret)

    // 手动删掉 @名字 时，把对应 chip 一并撤掉，避免发送时路由到没提到的人。
    const stillMentioned = mentioned.filter((id) => {
      const candidate = candidates.find((item) => item.id === id)
      return candidate ? nextValue.includes(`@${candidate.name}`) : false
    })
    if (stillMentioned.length !== mentioned.length) {
      onMentionedChange?.(stillMentioned)
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    // 输入法合成期间所有键位都交给浏览器，重写 DOM 会打断候选词。
    if (event.nativeEvent.isComposing || isComposingRef.current) {
      return
    }
    if (menu && menuItems > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        setMenu({ ...menu, active: (activeIndex + delta + menuItems) % menuItems })
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        if (menu.kind === 'mention') {
          applyMention(mentionMatches[activeIndex])
        } else {
          applyCommand(commandMatches[activeIndex].command)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenu(null)
        return
      }
    }

    // 原子退格：光标紧贴胶囊时整颗删掉，并让上方缩略图跟着消失。
    if (
      (event.key === 'Backspace' || event.key === 'Delete') &&
      onImagesChange !== undefined &&
      images.length > 0
    ) {
      const el = editorRef.current
      const selection = window.getSelection()
      if (el !== null && selection !== null && selection.isCollapsed) {
        const caret = caretOffsetOf(el)
        if (caret !== null) {
          const hit = deleteTokenAtCaret(
            draft,
            caret,
            event.key === 'Backspace' ? 'backspace' : 'delete'
          )
          if (hit.removedSlot !== null) {
            event.preventDefault()
            const removed = removeImageSlot(hit.text, images, hit.removedSlot)
            onDraftChange(removed.text)
            onImagesChange(removed.images)
            pendingCaretRef.current = hit.caret
            return
          }
        }
      }
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) {
        insertPlainText('\n')
        return
      }
      handleSubmitAction()
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>): void {
    const files = imageFilesOf(event.clipboardData)
    if (files.length > 0 && onImagesChange !== undefined) {
      event.preventDefault()
      void addFiles(files)
      return
    }
    // 资源管理器复制文件：Chromium 给的是 kind=file 但 type 为空的项，
    // 渲染层读不出像素，交给主进程走 uri-list 兜底。
    const hasOpaqueFiles = event.clipboardData.files.length > 0
    const text = event.clipboardData.getData('text/plain')
    if (!hasOpaqueFiles && text !== '') {
      // 只认纯文本：外部网页的富文本样式一律不进编辑区。
      // 粘进来的 [Image #N] 一律剥掉：同一 slot 出现两次会让胶囊与实体失去 1:1。
      event.preventDefault()
      const plain = text.replace(/\[Image #\d+\]\s*/g, '')
      if (plain !== '') {
        insertPlainText(plain)
      }
      return
    }
    if (onImagesChange !== undefined) {
      event.preventDefault()
      void pasteFromClipboard()
    }
  }

  /**
   * 窗口级粘贴兜底：没点进输入框（欢迎页 / 刚切回窗口）直接 Ctrl+V 也能贴图。
   * 其它输入控件内的粘贴不动，避免抢别人的剪贴板行为。
   */
  const documentPasteRef = useRef<(event: ClipboardEvent) => void>(() => {})
  documentPasteRef.current = (event: ClipboardEvent): void => {
    if (lightbox !== null) {
      return
    }
    const target = event.target instanceof HTMLElement ? event.target : null
    const editor = editorRef.current
    if (target !== null) {
      if (editor !== null && editor.contains(target)) {
        return
      }
      if (target.closest('input, textarea, [contenteditable="true"]') !== null) {
        return
      }
    }
    if (onImagesChange === undefined) {
      return
    }
    const files = imageFilesOf(event.clipboardData)
    if (files.length > 0) {
      event.preventDefault()
      editor?.focus()
      void addFiles(files)
      return
    }
    if (event.clipboardData !== null && event.clipboardData.files.length > 0) {
      event.preventDefault()
      editor?.focus()
      void pasteFromClipboard()
      return
    }
    if (event.clipboardData?.getData('text/plain') !== '') {
      return
    }
    event.preventDefault()
    editor?.focus()
    void pasteFromClipboard()
  }

  useEffect(() => {
    const handler = (event: ClipboardEvent): void => documentPasteRef.current(event)
    document.addEventListener('paste', handler)
    return () => document.removeEventListener('paste', handler)
  }, [])

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmitAction()
      }}
    >
      <div
        className="composer__box"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault()
          }
        }}
        onDrop={(event) => {
          // 不拦就会让 Chromium 把图片当成导航，整个窗口跳到 file://
          event.preventDefault()
          event.stopPropagation()
          if (event.dataTransfer.files.length > 0) {
            void addFiles(Array.from(event.dataTransfer.files))
          }
        }}
      >
        {images.length > 0 ? (
          <div className="composer__thumbs" aria-label="待发送图片">
            {images.map((image, position) => (
              <div key={image.dto.id} className="composer__thumb">
                <button
                  className="thumb thumb--composer"
                  type="button"
                  title={image.dto.name}
                  onClick={() =>
                    setLightbox({
                      images: images.map((item) => item.dto),
                      start: position
                    })
                  }
                >
                  <img className="thumb__img" src={image.previewUrl} alt={image.dto.name} />
                  <span className="thumb__badge">#{image.index}</span>
                </button>
                <button
                  className="composer__thumb-x"
                  type="button"
                  aria-label={`移除图片 #${image.index}`}
                  title="移除"
                  onClick={() => removeSlot(image.index)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {mentioned.length > 0 ? (
          <div className="composer__mentions" aria-label="已 @ 的成员">
            {mentioned.map((id) => {
              const candidate = candidates.find((item) => item.id === id)
              if (!candidate) {
                return null
              }
              return (
                <span key={id} className="composer__mention">
                  @{candidate.name}
                  <button
                    type="button"
                    className="composer__mention-x"
                    aria-label={`取消 @${candidate.name}`}
                    onClick={() => removeMention(candidate)}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>
        ) : null}

        {hint ? <p className="composer__hint">{hint}</p> : null}

        {mentioned.length > 1 ? (
          <p className="composer__hint">
            已 @ 多个成员：本轮仍由组长回答（多 Agent 同室排后续）
          </p>
        ) : null}

        {menu && menuItems > 0 ? (
          <div className="composer__menu" role="listbox" aria-label="指令或成员">
            {menu.kind === 'mention'
              ? mentionMatches.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`composer__menu-item${index === activeIndex ? ' is-on' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyMention(item)
                    }}
                  >
                    <span>@{item.name}</span>
                  </button>
                ))
              : commandMatches.map((item, index) => (
                  <button
                    key={item.command}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`composer__menu-item${index === activeIndex ? ' is-on' : ''}`}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyCommand(item.command)
                    }}
                  >
                    <code>{item.command}</code>
                    <span>{item.label}</span>
                  </button>
                ))}
          </div>
        ) : null}

        <div
          ref={editorRef}
          className="composer__input composer__editor"
          contentEditable
          role="textbox"
          aria-multiline="true"
          aria-label="输入消息"
          data-empty={draft === '' ? 'true' : 'false'}
          data-placeholder="输入消息，Enter 发送，Shift+Enter 换行；@ 成员，/ 指令"
          suppressContentEditableWarning
          onInput={handleEditorInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={() => {
            isComposingRef.current = true
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false
            // 合成结束后补一次同步：中文候选词落定可能改变胶囊前后位置。
            handleEditorInput()
          }}
          onClick={(event) => {
            // 点胶囊 → 直接开灯箱，定位到对应那张。
            const target = event.target instanceof Element ? event.target : null
            const chip = target?.closest(`[${CHIP_SLOT}]`)
            if (chip === null || chip === undefined) {
              return
            }
            const slot = Number(chip.getAttribute(CHIP_SLOT))
            if (!Number.isInteger(slot) || slot < 1) {
              return
            }
            event.preventDefault()
            setLightbox({
              images: images.map((item) => item.dto),
              start: Math.max(0, Math.min(slot - 1, images.length - 1))
            })
          }}
        />
        <div className="composer__bar">
          {onImagesChange !== undefined ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                hidden
                onChange={(event) => {
                  if (event.target.files !== null) {
                    void addFiles(Array.from(event.target.files))
                  }
                  event.target.value = ''
                }}
              />
              <button
                className="composer__add"
                type="button"
                aria-label="添加图片"
                title="添加图片（也可粘贴或拖入）"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="plus" size={13} />
              </button>
            </>
          ) : null}
          {/* 老的下拉分支：ChatPanel 现已恒传 modelPolicy（locked-*），这段在现网不可达；
              已定：保留，勿删（不破 chat.composer 契约）。 */}
          {modelPolicy === undefined ? (
            <>
              <label className="composer__pick" title="本次执行使用的模型（只影响这个会话）">
                <select
                  value={model}
                  onChange={(event) => onModelChange(event.target.value)}
                  aria-label="选择模型"
                >
                  {models.length === 0 ? <option value="">默认模型</option> : null}
                  {models.map((item) => (
                    <option key={item} value={item}>
                      {MODEL_LABEL[item] ?? item}
                    </option>
                  ))}
                </select>
              </label>

              <label className="composer__pick" title="思考预算：低 1k / 中 2k / 高 4k 输出上限">
                <select
                  value={effort ?? ''}
                  onChange={(event) => {
                    if (event.target.value !== '') {
                      onEffortChange(event.target.value as Effort)
                    }
                  }}
                  aria-label="思考等级"
                >
                  <option value="">思考 默认</option>
                  {(Object.keys(EFFORT_LABEL) as Effort[]).map((level) => (
                    <option key={level} value={level}>
                      思考 {EFFORT_LABEL[level]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          ) : modelPolicy.mode === 'editable' ? (
            modelPicker ?? null
          ) : (
            <span
              className="composer__model-badge"
              title={
                modelPolicy.mode === 'locked-agent'
                  ? '模型由该 Agent 的绑定决定，点击去右侧检查器修改'
                  : '群聊：输入 @ 指定成员接管本轮'
              }
            >
              {modelBadge}
            </span>
          )}

          {routePreview ? <span className="composer__route">{routePreview}</span> : null}
          <Slot name="chat.composer.toolbar" props={{ draft, busy }} />

          <span className="composer__spacer" />
          <button
            className="msg__act"
            type="button"
            onClick={() => onPlan()}
            disabled={busy || draft.trim() === ''}
            title="把这句话交给 Agent 生成执行计划"
          >
            <Icon name="compass" size={14} />
            计划
          </button>
          {busy ? (
            <button className="btn-stop" type="button" onClick={onStop}>
              停止
            </button>
          ) : (
            <button className="btn-send" type="submit" disabled={!canSend}>
              发送
            </button>
          )}
        </div>
      </div>
      <ImageLightbox state={lightbox} onClose={() => setLightbox(null)} />
    </form>
  )
}
