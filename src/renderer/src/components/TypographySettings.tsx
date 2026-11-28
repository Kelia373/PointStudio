// 设置 → 字体与字号：全局字体 + 代码字体两个可下拉展开的选择器。
//
// 选中即生效：变量写在 documentElement 上（--font-ui / --mono-code），
// 全站样式通过 tokens.css 的 --font / --mono 直接跟着变，不用重渲染整棵树；
// 同时写 localStorage，下次启动由 main.tsx 在首帧前恢复。
import { useState } from 'react'

import Icon from './Icon'
import {
  applyTypography,
  CODE_FONTS,
  DEFAULT_TYPOGRAPHY,
  isDefaultTypography,
  parseTypography,
  serializeTypography,
  TYPOGRAPHY_STORAGE_KEY,
  UI_FONTS,
  type FontCategory,
  type FontFamilyOption,
  type TypographyState
} from '../lib/typography'

const SAMPLE_LATIN = 'The quick brown fox jumps over the lazy dog · 0123456789'
const SAMPLE_CJK = '中文回退到系统字体，混排时基线不跳。'
const SAMPLE_CODE = `function toggle(todo: Todo): Todo {
  return { ...todo, done: !todo.done }
}`

function readTypography(): TypographyState {
  return parseTypography(window.localStorage.getItem(TYPOGRAPHY_STORAGE_KEY))
}

function FontPanel({
  title,
  description,
  category,
  options,
  value,
  onChange
}: {
  title: string
  description: string
  category: FontCategory
  options: readonly FontFamilyOption[]
  value: string
  onChange: (id: string) => void
}) {
  // 两个面板各自展开，互不影响：可以只开代码字体挑字。
  const [open, setOpen] = useState(false)
  const selected = options.find((item) => item.id === value) ?? options[0]!

  return (
    <section className="font-panel" data-open={open ? 'true' : 'false'}>
      <button
        className="font-panel__head"
        type="button"
        aria-expanded={open}
        aria-controls={`font-panel-${category}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="font-panel__label">
          <b>{title}</b>
          <span className="settings-note">{description}</span>
        </span>
        <span className="font-panel__current" style={{ fontFamily: selected.css }}>
          {selected.label}
        </span>
        <Icon name="arrow-down" size={14} className="font-panel__caret" />
      </button>

      {open ? (
        <div className="font-panel__list" id={`font-panel-${category}`} role="listbox">
          {options.map((option) => {
            const active = option.id === selected.id
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={active}
                className="font-option"
                data-active={active ? 'true' : 'false'}
                onClick={() => onChange(option.id)}
              >
                <span className="font-option__name" style={{ fontFamily: option.css }}>
                  {option.label}
                </span>
                <span className="font-option__sample" style={{ fontFamily: option.css }}>
                  {category === 'code' ? 'const sum = (a, b) => a + b;' : 'Aa Bb Cc · 0123'}
                </span>
                <span className="font-option__meta">
                  <span className="font-option__tag">{option.license}</span>
                  <span className="settings-note">{option.note}</span>
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

export default function TypographySettings() {
  const [state, setState] = useState<TypographyState>(readTypography)

  function commit(next: TypographyState): void {
    const applied = applyTypography(next, document.documentElement)
    window.localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, serializeTypography(applied))
    setState(applied)
  }

  const dirty = !isDefaultTypography(state)

  return (
    <div className="settings-form font-settings">
      <p className="settings-note">
        字体随包内置（SIL OFL-1.1，可商用），离线可用；中文自动回退系统字体。
      </p>

      <FontPanel
        title="全局字体"
        description="对话、侧栏、设置等全部正文"
        category="ui"
        options={UI_FONTS}
        value={state.ui}
        onChange={(id) => commit({ ...state, ui: id })}
      />

      <FontPanel
        title="代码字体"
        description="代码块、行内代码与路径"
        category="code"
        options={CODE_FONTS}
        value={state.code}
        onChange={(id) => commit({ ...state, code: id })}
      />

      <div className="font-preview">
        <div className="font-preview__row">
          <span className="font-preview__caption">正文预览</span>
          <p className="font-preview__text">{SAMPLE_LATIN}</p>
          <p className="font-preview__text font-preview__text--dim">{SAMPLE_CJK}</p>
        </div>
        <div className="font-preview__row">
          <span className="font-preview__caption">代码预览</span>
          <pre className="font-preview__code">
            <code>{SAMPLE_CODE}</code>
          </pre>
        </div>
      </div>

      <div className="settings__actions">
        <button
          className="settings__save"
          type="button"
          disabled={!dirty}
          onClick={() => commit(DEFAULT_TYPOGRAPHY)}
        >
          恢复默认
        </button>
        <span className="settings-note">
          {dirty ? '已保存到本机，重启后仍然生效。' : '当前就是默认字体。'}
        </span>
      </div>
    </div>
  )
}
