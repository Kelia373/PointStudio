// MarkdownBody —— 结构化 Markdown 渲染（零 dangerouslySetInnerHTML）。
import { useState } from 'react'

import {
  parseInlineTokens,
  parseMarkdownBlocks,
  type InlineToken
} from '../lib/chatMarkdown'
import Icon from './Icon'

function Inline({ tokens }: { tokens: InlineToken[] }) {
  return (
    <>
      {tokens.map((token, index) => {
        if (token.type === 'text') {
          return <span key={index}>{token.value}</span>
        }
        if (token.type === 'code') {
          return (
            <code key={index} className="md__code-inline">
              {token.value}
            </code>
          )
        }
        if (token.type === 'strong') {
          return (
            <strong key={index}>
              <Inline tokens={token.children} />
            </strong>
          )
        }
        if (token.type === 'em') {
          return (
            <em key={index}>
              <Inline tokens={token.children} />
            </em>
          )
        }
        if (token.type === 'strike') {
          return (
            <del key={index}>
              <Inline tokens={token.children} />
            </del>
          )
        }
        return (
          <a
            key={index}
            href={token.href}
            target="_blank"
            rel="noreferrer noopener"
            className="md__link"
          >
            {token.label}
          </a>
        )
      })}
    </>
  )
}

function CodeBlock({ lang, code, closed }: { lang: string; code: string; closed: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={`md__code${closed ? '' : ' is-streaming'}`}>
      <div className="md__code-head">
        <span className="md__code-lang">{lang === '' ? 'text' : lang}</span>
        <button
          className="md__code-copy"
          type="button"
          onClick={() => {
            void window.pointstudio.clipboard.writeText(code).then((ok) => {
              if (!ok) {
                return
              }
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1500)
            })
          }}
        >
          <Icon name="download" size={11} />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="md__code-body">
        <code>{code}</code>
      </pre>
    </div>
  )
}

export default function MarkdownBody({
  content,
  className = ''
}: {
  content: string
  className?: string
}) {
  const blocks = parseMarkdownBlocks(content)
  return (
    <div className={`md${className === '' ? '' : ` ${className}`}`}>
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
          return (
            <Tag key={index} className="md__heading">
              <Inline tokens={parseInlineTokens(block.text)} />
            </Tag>
          )
        }
        if (block.type === 'paragraph') {
          return (
            <p key={index} className="md__paragraph">
              {block.lines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {lineIndex > 0 ? <br /> : null}
                  <Inline tokens={parseInlineTokens(line)} />
                </span>
              ))}
            </p>
          )
        }
        if (block.type === 'code') {
          return (
            <CodeBlock key={index} lang={block.lang} code={block.code} closed={block.closed} />
          )
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag key={index} className="md__list">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inline tokens={parseInlineTokens(item)} />
                </li>
              ))}
            </Tag>
          )
        }
        if (block.type === 'blockquote') {
          return (
            <blockquote key={index} className="md__quote">
              {block.lines.map((line, lineIndex) => (
                <p key={lineIndex}>
                  <Inline tokens={parseInlineTokens(line)} />
                </p>
              ))}
            </blockquote>
          )
        }
        if (block.type === 'table') {
          return (
            <table key={index} className="md__table">
              <thead>
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th key={headerIndex}>
                      <Inline tokens={parseInlineTokens(header)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex}>
                        <Inline tokens={parseInlineTokens(cell)} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
        return <hr key={index} className="md__hr" />
      })}
    </div>
  )
}
